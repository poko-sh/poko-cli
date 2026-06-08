import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathExists } from "../../core/config.ts";
import {
  type CursorWorkspace,
  cursorFileUri,
  cursorWorkspaceIdentifier,
  ensureCursorStateDatabase,
  ensureCursorWorkspace,
  resolveCursorGlobalStateDbPath,
  resolveCursorWorkspaceStorageRoot,
} from "../cursor-storage.ts";
import { sourceLineageId } from "../lineage.ts";
import type { RawHistoryMessage, RawHistorySession } from "../types.ts";
import {
  closeAppForNativeSync,
  type NativeAppController,
  type NativeAppLifecycle,
  reopenAppAfterNativeSync,
} from "./app-lifecycle.ts";
import {
  conversationMessages,
  countConversationMessages,
  countSameAgentSessions,
  dateFrom,
  deterministicUuid,
  messageDate,
  nativeTargetSessions,
  resolveRealProjectRoot,
  sessionCreatedDate,
  sessionUpdatedDate,
  timestampMs,
  truncate,
} from "./common.ts";
import type {
  NativeHistorySyncer,
  NativeHistorySyncOptions,
  NativeHistorySyncResult,
} from "./types.ts";

type CursorRenderedSession = {
  composerId: string;
  head: Record<string, unknown>;
  composerData: Record<string, unknown>;
  bubbles: Array<{ key: string; value: Record<string, unknown> }>;
};

type CursorRenderedBubble = {
  header: Record<string, unknown>;
  key: string;
  value: Record<string, unknown>;
};

type CursorMessageAnnotations = {
  visibleText: string;
  thinkingText?: string;
  toolResult?: string;
  toolUses: CursorToolUse[];
  fileRefs: CursorFileRef[];
};

type CursorToolUse = {
  name: string;
  input: Record<string, unknown>;
};

type CursorFileRef = {
  relativePath: string;
  line?: number;
};

type CursorWriteStats = {
  composerRecordsWritten: number;
  bubblesWritten: number;
  staleComposersRemoved: number;
};

type CursorNativeHistorySyncOptions = NativeHistorySyncOptions & {
  appController?: NativeAppController;
};

const CURSOR_IMPORT_MODEL = "composer-2.5";

export const cursorNativeSyncer: NativeHistorySyncer = {
  id: "cursor",
  sync: syncCursorNativeHistory,
};

export async function syncCursorNativeHistory(
  options: CursorNativeHistorySyncOptions,
): Promise<NativeHistorySyncResult> {
  const storageRoot = resolveCursorWorkspaceStorageRoot();
  const globalStateDbPath = resolveCursorGlobalStateDbPath();
  const sessions = nativeTargetSessions(options.sessions, "cursor");
  const messageCount = countConversationMessages(sessions);
  const sameAgentSessions = countSameAgentSessions(options.sessions, "cursor");

  if (options.dryRun) {
    return {
      target: "cursor",
      location: globalStateDbPath,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: true,
      skipped: false,
      details: {
        composerRecordsWritten: sessions.length,
        bubblesWritten: messageCount,
        sessionsSkippedFromSameAgent: sameAgentSessions,
      },
    };
  }

  if (sessions.length === 0) {
    return {
      target: "cursor",
      location: globalStateDbPath,
      sessions: 0,
      messages: 0,
      dryRun: false,
      skipped: false,
      details: {
        composerRecordsWritten: 0,
        bubblesWritten: 0,
        staleComposersRemoved: 0,
        sessionsSkippedFromSameAgent: sameAgentSessions,
      },
    };
  }

  if (!(await pathExists(globalStateDbPath))) {
    return {
      target: "cursor",
      location: globalStateDbPath,
      sessions: 0,
      messages: 0,
      dryRun: false,
      skipped: true,
      reason: "Cursor global state.vscdb was not found.",
    };
  }

  const projectRoot = await resolveRealProjectRoot(options.root);
  const lifecycle = await closeCursorForNativeSync(options);

  if (lifecycle.reason) {
    return {
      target: "cursor",
      location: globalStateDbPath,
      sessions: 0,
      messages: 0,
      dryRun: false,
      skipped: true,
      reason: lifecycle.reason,
      details: {
        cursorWasRunning: lifecycle.wasRunning,
        cursorClosed: lifecycle.closed,
        cursorReopened: lifecycle.reopened,
      },
    };
  }

  let globalDatabase: Database | undefined;
  let workspaceDatabase: Database | undefined;
  let result: NativeHistorySyncResult;

  try {
    const workspace = await ensureCursorWorkspace(storageRoot, projectRoot);
    ensureCursorStateDatabase(globalStateDbPath, ["ItemTable", "cursorDiskKV"]);
    ensureCursorStateDatabase(workspace.databasePath, ["ItemTable"]);

    globalDatabase = new Database(globalStateDbPath);
    workspaceDatabase = new Database(workspace.databasePath);
    globalDatabase.run("pragma busy_timeout = 5000");
    workspaceDatabase.run("pragma busy_timeout = 5000");

    const fallbackDate = dateFrom(options.config.project.createdAt, new Date());
    const rendered = sessions.map((session) =>
      renderCursorSession({
        session,
        workspace,
        projectRoot,
        projectId: options.config.project.id,
        fallbackDate,
      }),
    );

    const stats = writeCursorImports({
      globalDatabase,
      workspaceDatabase,
      workspace,
      projectRoot,
      rendered,
    });

    result = {
      target: "cursor",
      location: globalStateDbPath,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: false,
      skipped: false,
      details: {
        ...stats,
        cursorWasRunning: lifecycle.wasRunning,
        cursorClosed: lifecycle.closed,
        cursorReopened: lifecycle.reopened,
        sessionsSkippedFromSameAgent: sameAgentSessions,
      },
    };
  } finally {
    workspaceDatabase?.close();
    globalDatabase?.close();
    await reopenCursorAfterNativeSync(options, lifecycle);
  }

  if (result.details) {
    result.details.cursorReopened = lifecycle.reopened;
  }

  return result;
}

const renderCursorSession = (input: {
  session: RawHistorySession;
  workspace: CursorWorkspace;
  projectRoot: string;
  projectId: string;
  fallbackDate: Date;
}): CursorRenderedSession => {
  const composerId = deterministicUuid(
    `poko:cursor:composer:${input.session.sourceAgent}:${input.session.id}`,
  );
  const created = sessionCreatedDate(input.session, input.fallbackDate);
  const updated = sessionUpdatedDate(input.session, created);
  const createdMs = timestampMs(created);
  const updatedMs = timestampMs(updated);
  const title = truncate(input.session.title || "Poko import", 80);
  const workspaceIdentifier = cursorWorkspaceIdentifier(
    input.workspace,
    input.projectRoot,
  );
  const pokoImport = {
    originator: "poko",
    sourceAgent: input.session.sourceAgent,
    sourceSessionId: input.session.id,
    lineageId: sourceLineageId(input.session),
    projectId: input.projectId,
    projectRoot: input.projectRoot,
  };
  const messages = conversationMessages(input.session);
  const renderedBubbles = messages.flatMap((message, index) =>
    renderCursorMessageBubbles({
      composerId,
      session: input.session,
      message,
      index,
      created,
      projectRoot: input.projectRoot,
      workspace: input.workspace,
      pokoImport,
    }),
  );
  const headers = renderedBubbles.map((bubble) => bubble.header);
  const bubbles = renderedBubbles.map(({ key, value }) => ({ key, value }));

  const head = {
    type: "head",
    composerId,
    name: title,
    lastUpdatedAt: updatedMs,
    conversationCheckpointLastUpdatedAt: updatedMs,
    createdAt: createdMs,
    unifiedMode: "agent",
    forceMode: "edit",
    hasUnreadMessages: false,
    contextUsagePercent: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    filesChangedCount: 0,
    hasBlockingPendingActions: false,
    hasPendingPlan: false,
    isArchived: false,
    isDraft: false,
    isWorktree: false,
    worktreeStartedReadOnly: false,
    isSpec: false,
    isProject: false,
    isBestOfNSubcomposer: false,
    numSubComposers: 0,
    referencedPlans: [],
    trackedGitRepos: [],
    workspaceIdentifier,
    agentLocation: {
      type: "local",
      environment: workspaceIdentifier,
      status: "active",
    },
    agentLocationHistory: [
      {
        id: deterministicUuid(`poko:cursor:location:${composerId}`),
        timestamp: createdMs,
        destination: { type: "local" },
        location: {
          type: "local",
          environment: workspaceIdentifier,
          status: "active",
        },
        reason: "created",
      },
    ],
    pokoImport,
  };

  return {
    composerId,
    head,
    composerData: {
      _v: 16,
      composerId,
      richText: emptyCursorRichText(),
      hasLoaded: true,
      text: "",
      fullConversationHeadersOnly: headers,
      conversationMap: {},
      status: "completed",
      context: emptyCursorContext(),
      gitGraphFileSuggestions: [],
      generatingBubbleIds: [],
      isReadingLongFile: false,
      codeBlockData: {},
      originalFileStates: {},
      newlyCreatedFiles: [],
      newlyCreatedFolders: [],
      lastUpdatedAt: updatedMs,
      createdAt: createdMs,
      hasChangedContext: false,
      activeTabsShouldBeReactive: true,
      capabilities: [],
      name: title,
      isFileListExpanded: false,
      browserChipManuallyDisabled: false,
      browserChipManuallyEnabled: false,
      unifiedMode: "agent",
      forceMode: "edit",
      usageData: {},
      contextUsagePercent: 0,
      contextTokensUsed: 0,
      contextTokenLimit: 0,
      allAttachedFileCodeChunksUris: [],
      modelConfig: {
        modelName: CURSOR_IMPORT_MODEL,
        maxMode: false,
        selectedModels: [
          {
            modelId: CURSOR_IMPORT_MODEL,
            parameters: [{ id: "fast", value: "true" }],
          },
        ],
      },
      subComposerIds: [],
      capabilityContexts: [],
      todos: [],
      isQueueExpanded: false,
      hasUnreadMessages: false,
      gitHubPromptDismissed: true,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
      addedFiles: [],
      removedFiles: [],
      isArchived: false,
      isDraft: false,
      isCreatingWorktree: false,
      isApplyingWorktree: false,
      isUndoingWorktree: false,
      applied: false,
      pendingCreateWorktree: false,
      isBestOfNSubcomposer: false,
      isBestOfNParent: false,
      isSpec: false,
      isSpecSubagentDone: false,
      stopHookLoopCount: 0,
      isNAL: false,
      planModeSuggestionUsed: false,
      latestChatGenerationUUID: "",
      isAgentic: true,
      subtitle: `${messages.length} imported message(s) from ${input.session.sourceAgent}`,
      filesChangedCount: 0,
      trackedGitRepos: [],
      workspaceIdentifier,
      pokoImport,
    },
    bubbles,
  };
};

const renderCursorMessageBubbles = (input: {
  composerId: string;
  session: RawHistorySession;
  message: RawHistoryMessage;
  index: number;
  created: Date;
  projectRoot: string;
  workspace: CursorWorkspace;
  pokoImport: Record<string, unknown>;
}): CursorRenderedBubble[] => {
  const annotations = cursorMessageAnnotations(
    input.message,
    input.projectRoot,
  );
  const bubbleId = cursorBubbleId(input.session, input.message, input.index);
  const bubbles: CursorRenderedBubble[] = [];

  if (annotations.thinkingText) {
    const thinkingBubbleId = cursorThinkingBubbleId(
      input.session,
      input.message,
      input.index,
    );
    const thinkingMessage = {
      ...input.message,
      text: "",
    };

    bubbles.push({
      header: {
        bubbleId: thinkingBubbleId,
        type: 2,
      },
      key: `bubbleId:${input.composerId}:${thinkingBubbleId}`,
      value: renderCursorBubble({
        message: thinkingMessage,
        index: input.index,
        bubbleId: thinkingBubbleId,
        created: input.created,
        projectRoot: input.projectRoot,
        workspace: input.workspace,
        pokoImport: input.pokoImport,
        thinkingText: annotations.thinkingText,
        fileRefs: [],
      }),
    });
  }

  if (annotations.visibleText || input.message.role === "user") {
    const messageForBubble = {
      ...input.message,
      text: annotations.visibleText || input.message.text,
    };

    bubbles.push({
      header: renderCursorHeader({
        bubbleId,
        role: input.message.role,
        text: messageForBubble.text,
      }),
      key: `bubbleId:${input.composerId}:${bubbleId}`,
      value: renderCursorBubble({
        message: messageForBubble,
        index: input.index,
        bubbleId,
        created: input.created,
        projectRoot: input.projectRoot,
        workspace: input.workspace,
        pokoImport: input.pokoImport,
        fileRefs: annotations.fileRefs,
      }),
    });
  }

  for (const [toolIndex, toolUse] of annotations.toolUses.entries()) {
    const toolBubbleId = cursorToolBubbleId(
      input.session,
      input.message,
      input.index,
      toolIndex,
      toolUse.name,
    );

    bubbles.push({
      header: {
        bubbleId: toolBubbleId,
        type: 2,
      },
      key: `bubbleId:${input.composerId}:${toolBubbleId}`,
      value: renderCursorToolBubble({
        toolUse,
        toolIndex,
        bubbleId: toolBubbleId,
        message: input.message,
        created: input.created,
        projectRoot: input.projectRoot,
        result: annotations.toolResult,
        fileRefs: annotations.fileRefs,
      }),
    });
  }

  return bubbles;
};

const renderCursorHeader = (input: {
  bubbleId: string;
  role: RawHistoryMessage["role"];
  text: string;
}): Record<string, unknown> => {
  const header: Record<string, unknown> = {
    bubbleId: input.bubbleId,
    type: input.role === "user" ? 1 : 2,
  };

  if (input.role === "assistant") {
    header.grouping = {
      isRenderable: true,
      hasText: true,
      isShortPlainText: input.text.length <= 240,
      isKeptFinalAiVisibleOutsideWorkedForGroup: true,
    };
  }

  return header;
};

const renderCursorBubble = (input: {
  message: RawHistoryMessage;
  index: number;
  bubbleId: string;
  created: Date;
  projectRoot: string;
  workspace: CursorWorkspace;
  pokoImport: Record<string, unknown>;
  thinkingText?: string;
  fileRefs: CursorFileRef[];
}): Record<string, unknown> => {
  const timestamp = messageDate(input.message, input.created).toISOString();
  const fileLinks = cursorFileLinks(input.fileRefs);
  const common = {
    _v: 3,
    type: input.message.role === "user" ? 1 : 2,
    approximateLintErrors: [],
    lints: [],
    codebaseContextChunks: [],
    commits: [],
    pullRequests: [],
    attachedCodeChunks: [],
    assistantSuggestedDiffs: [],
    gitDiffs: [],
    interpreterResults: [],
    images: [],
    attachedFolders: [],
    attachedFoldersNew: [],
    bubbleId: input.bubbleId,
    userResponsesToSuggestedCodeBlocks: [],
    suggestedCodeBlocks: [],
    diffsForCompressingFiles: [],
    relevantFiles: [],
    toolResults: [],
    notepads: [],
    capabilities: [],
    capabilityStatuses: emptyCursorCapabilityStatuses(),
    multiFileLinterErrors: [],
    diffHistories: [],
    recentLocationsHistory: [],
    recentlyViewedFiles: [],
    isAgentic: true,
    fileDiffTrajectories: [],
    existedSubsequentTerminalCommand: false,
    existedPreviousTerminalCommand: false,
    docsReferences: [],
    webReferences: [],
    aiWebSearchResults: [],
    requestId: "",
    attachedFoldersListDirResults: [],
    humanChanges: [],
    summarizedComposers: [],
    cursorRules: [],
    contextPieces: [],
    editTrailContexts: [],
    allThinkingBlocks: [],
    diffsSinceLastApply: [],
    deletedFiles: [],
    supportedTools: [],
    tokenCount: {
      inputTokens: 0,
      outputTokens: 0,
    },
    attachedFileCodeChunksMetadataOnly: [],
    consoleLogs: [],
    uiElementPicked: [],
    isRefunded: false,
    knowledgeItems: [],
    documentationSelections: [],
    externalLinks: [],
    useWeb: false,
    projectLayouts: [],
    unifiedMode: 2,
    capabilityContexts: [],
    todos: [],
    createdAt: timestamp,
    isQuickSearchQuery: false,
    mcpDescriptors: [],
    workspaceUris: [cursorFileUri(input.projectRoot)],
    ...(fileLinks.length > 0 ? { fileLinks } : {}),
    text: input.message.text,
    modelInfo: {
      modelName: CURSOR_IMPORT_MODEL,
    },
    workspaceProjectDir: cursorProjectDir(input.projectRoot),
    context: emptyCursorContext(),
    pokoImport: input.pokoImport,
  };

  if (input.message.role === "user") {
    return {
      ...common,
      richText: cursorRichText(input.message.text),
      editToolSupportsSearchAndReplace: false,
      ...(input.fileRefs.length > 0
        ? {
            attachedFileCodeChunksMetadataOnly: input.fileRefs.map(
              cursorAttachedFileMetadata,
            ),
          }
        : {}),
    };
  }

  return {
    ...common,
    codeBlocks: [],
    timingInfo: {
      clientRpcSendTime: timestampMs(new Date(timestamp), input.index),
      clientSettleTime: timestampMs(new Date(timestamp), input.index),
      clientEndTime: timestampMs(new Date(timestamp), input.index),
    },
    ...(input.thinkingText
      ? {
          thinking: {
            text: input.thinkingText,
            signature: "",
          },
          thinkingDurationMs: 1000,
          thinkingStyle: "default",
        }
      : {}),
  };
};

const renderCursorToolBubble = (input: {
  toolUse: CursorToolUse;
  toolIndex: number;
  bubbleId: string;
  message: RawHistoryMessage;
  created: Date;
  projectRoot: string;
  result?: string;
  fileRefs: CursorFileRef[];
}): Record<string, unknown> => {
  const timestamp = messageDate(input.message, input.created).toISOString();
  const normalized = normalizeCursorToolUse(input.toolUse, input.projectRoot);
  const fileLinks = cursorFileLinks(input.fileRefs);

  return {
    _v: 3,
    type: 2,
    bubbleId: input.bubbleId,
    text: "",
    createdAt: timestamp,
    approximateLintErrors: [],
    lints: [],
    codebaseContextChunks: [],
    commits: [],
    pullRequests: [],
    attachedCodeChunks: [],
    assistantSuggestedDiffs: [],
    gitDiffs: [],
    interpreterResults: [],
    images: [],
    attachedFolders: [],
    attachedFoldersNew: [],
    userResponsesToSuggestedCodeBlocks: [],
    suggestedCodeBlocks: [],
    diffsForCompressingFiles: [],
    relevantFiles: [],
    toolResults: [],
    notepads: [],
    capabilities: [],
    capabilityStatuses: emptyCursorCapabilityStatuses(),
    multiFileLinterErrors: [],
    diffHistories: [],
    recentLocationsHistory: [],
    recentlyViewedFiles: [],
    isAgentic: true,
    fileDiffTrajectories: [],
    existedSubsequentTerminalCommand: false,
    existedPreviousTerminalCommand: false,
    docsReferences: [],
    webReferences: [],
    aiWebSearchResults: [],
    requestId: "",
    attachedFoldersListDirResults: [],
    humanChanges: [],
    summarizedComposers: [],
    cursorRules: [],
    contextPieces: [],
    editTrailContexts: [],
    allThinkingBlocks: [],
    diffsSinceLastApply: [],
    deletedFiles: [],
    supportedTools: [],
    tokenCount: {
      inputTokens: 0,
      outputTokens: 0,
    },
    attachedFileCodeChunksMetadataOnly: input.fileRefs.map(
      cursorAttachedFileMetadata,
    ),
    consoleLogs: [],
    uiElementPicked: [],
    isRefunded: false,
    knowledgeItems: [],
    documentationSelections: [],
    externalLinks: [],
    useWeb: false,
    projectLayouts: [],
    unifiedMode: 2,
    capabilityContexts: [],
    todos: [],
    isQuickSearchQuery: false,
    mcpDescriptors: [],
    workspaceUris: [cursorFileUri(input.projectRoot)],
    ...(fileLinks.length > 0 ? { fileLinks } : {}),
    modelInfo: {
      modelName: CURSOR_IMPORT_MODEL,
    },
    workspaceProjectDir: cursorProjectDir(input.projectRoot),
    context: emptyCursorContext(),
    capabilityType: normalized.capabilityType,
    toolFormerData: {
      tool: normalized.tool,
      toolIndex: input.toolIndex + 1,
      modelCallId: deterministicUuid(
        `poko:cursor:model-call:${input.message.id ?? input.bubbleId}`,
      ),
      toolCallId: deterministicCursorToolCallId(
        `poko:cursor:tool-call:${input.bubbleId}`,
      ),
      status: "completed",
      rawArgs: JSON.stringify(normalized.rawArgs),
      name: normalized.name,
      params: JSON.stringify(normalized.params),
      additionalData: {},
      result: input.result ?? "",
    },
  };
};

const cursorMessageAnnotations = (
  message: RawHistoryMessage,
  projectRoot: string,
): CursorMessageAnnotations => {
  const rawToolUses = cursorToolUsesFromRaw(message.raw);
  const fileRefs = new Map<string, CursorFileRef>();
  const visibleLines: string[] = [];
  let thinkingText: string | undefined;
  let toolResult: string | undefined;
  const textToolUses: CursorToolUse[] = [];

  for (const line of message.text.split("\n")) {
    const thinkingMatch = line.match(/^\[thinking\]\s*(.+)$/i);

    if (thinkingMatch?.[1]) {
      thinkingText = appendAnnotationText(thinkingText, thinkingMatch[1]);
      continue;
    }

    const toolResultMatch = line.match(/^Tool result:\s*(.+)$/i);

    if (toolResultMatch?.[1]) {
      toolResult = appendAnnotationText(toolResult, toolResultMatch[1]);
      continue;
    }

    const toolUseMatch = line.match(/^\[(?:tool_use|tool_call):([^\]]+)\]$/i);

    if (toolUseMatch?.[1]) {
      textToolUses.push({
        name: toolUseMatch[1],
        input: {},
      });
      continue;
    }

    visibleLines.push(line);
  }

  for (const ref of [
    ...cursorFileRefsFromText(message.text, projectRoot),
    ...rawToolUses.flatMap((toolUse) =>
      cursorFileRefsFromToolInput(toolUse.input, projectRoot),
    ),
  ]) {
    fileRefs.set(`${ref.relativePath}:${ref.line ?? ""}`, ref);
  }

  const toolUses = rawToolUses.length > 0 ? rawToolUses : textToolUses;

  return {
    visibleText: visibleLines.join("\n").trim(),
    thinkingText,
    toolResult,
    toolUses,
    fileRefs: [...fileRefs.values()],
  };
};

const cursorToolUsesFromRaw = (raw: unknown): CursorToolUse[] => {
  const content = rawMessageContent(raw);

  return content.filter(isRecord).flatMap((part) => {
    if (
      (part.type !== "tool_use" && part.type !== "toolCall") ||
      typeof part.name !== "string"
    ) {
      return [];
    }

    return [
      {
        name: part.name,
        input: isRecord(part.input) ? part.input : {},
      },
    ];
  });
};

const rawMessageContent = (raw: unknown): unknown[] => {
  if (!isRecord(raw)) {
    return [];
  }

  if (isRecord(raw.payload) && Array.isArray(raw.payload.content)) {
    return raw.payload.content;
  }

  if (isRecord(raw.message) && Array.isArray(raw.message.content)) {
    return raw.message.content;
  }

  return [];
};

const appendAnnotationText = (
  existing: string | undefined,
  next: string,
): string => (existing ? `${existing}\n${next}` : next.trim());

const normalizeCursorToolUse = (
  toolUse: CursorToolUse,
  projectRoot: string,
): {
  name: string;
  tool: number;
  capabilityType: number;
  rawArgs: Record<string, unknown>;
  params: Record<string, unknown>;
} => {
  const name = toolUse.name.toLowerCase();
  const filePath = cursorToolInputPath(toolUse.input);

  if (name === "read" || name === "read_file" || name === "read_file_v2") {
    const relativePath = filePath
      ? normalizeCursorRelativePath(filePath, projectRoot)?.relativePath
      : undefined;

    return {
      name: "read_file",
      tool: 40,
      capabilityType: 15,
      rawArgs: {
        target_file: relativePath ?? filePath ?? "",
      },
      params: {
        targetFile: relativePath ?? filePath ?? "",
        charsLimit: 20000,
        ...(relativePath
          ? {
              effectiveUri: cursorFileUri(path.join(projectRoot, relativePath)),
            }
          : {}),
      },
    };
  }

  return {
    name: toolUse.name,
    tool: 19,
    capabilityType: 15,
    rawArgs: toolUse.input,
    params: {
      tools: [toolUse.name],
      fileOutputThresholdBytes: 20000,
    },
  };
};

const cursorToolInputPath = (
  input: Record<string, unknown>,
): string | undefined => {
  for (const key of ["file_path", "target_file", "targetFile", "path"]) {
    const value = input[key];

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
};

const cursorFileRefsFromToolInput = (
  input: Record<string, unknown>,
  projectRoot: string,
): CursorFileRef[] => {
  const filePath = cursorToolInputPath(input);
  const ref = filePath
    ? normalizeCursorRelativePath(filePath, projectRoot)
    : undefined;

  return ref ? [ref] : [];
};

const cursorFileRefsFromText = (
  text: string,
  projectRoot: string,
): CursorFileRef[] => {
  const refs: CursorFileRef[] = [];
  const pattern =
    /(?:^|[\s("'])((?:\.?\.?\/)?[A-Za-z0-9._/-]+\.[A-Za-z0-9]+)(?::(\d+))?/g;
  let match: RegExpExecArray | null;

  match = pattern.exec(text);

  while (match) {
    const ref = normalizeCursorRelativePath(
      match[1] ?? "",
      projectRoot,
      match[2] ? Number.parseInt(match[2], 10) : undefined,
    );

    if (ref) {
      refs.push(ref);
    }

    match = pattern.exec(text);
  }

  return refs;
};

const normalizeCursorRelativePath = (
  value: string,
  projectRoot: string,
  line?: number,
): CursorFileRef | undefined => {
  const lineMatch = value.match(/^(.*?):(\d+)$/);
  const withoutLine = lineMatch?.[1] ?? value;
  const parsedLine =
    line ?? (lineMatch?.[2] ? Number.parseInt(lineMatch[2], 10) : undefined);
  const resolved = path.isAbsolute(withoutLine)
    ? withoutLine
    : path.resolve(projectRoot, withoutLine);
  const relativePath = path.relative(projectRoot, resolved);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    !relativePath
  ) {
    return undefined;
  }

  return {
    relativePath: normalizePath(relativePath),
    ...(parsedLine && Number.isFinite(parsedLine) ? { line: parsedLine } : {}),
  };
};

const cursorFileLinks = (refs: CursorFileRef[]): string[] =>
  refs.map((ref) =>
    JSON.stringify({
      displayName: path.basename(ref.relativePath),
      relativeWorkspacePath: ref.relativePath,
    }),
  );

const cursorAttachedFileMetadata = (
  ref: CursorFileRef,
): Record<string, unknown> => ({
  relativeWorkspacePath: ref.relativePath,
  startLineNumber: ref.line ?? 1,
  lines: [],
  languageIdentifier: "",
  intent: 8,
  isOnlyIncludedFromFolder: false,
});

const deterministicCursorToolCallId = (value: string): string =>
  `toolu_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;

const normalizePath = (value: string): string =>
  value.split(path.sep).join("/");

const writeCursorImports = (input: {
  globalDatabase: Database;
  workspaceDatabase: Database;
  workspace: CursorWorkspace;
  projectRoot: string;
  rendered: CursorRenderedSession[];
}): CursorWriteStats => {
  const desiredIds = new Set(
    input.rendered.map((session) => session.composerId),
  );
  const staleComposersRemoved = cleanupStalePokoCursorImports({
    database: input.globalDatabase,
    projectRoot: input.projectRoot,
    desiredIds,
  });

  for (const session of input.rendered) {
    input.globalDatabase
      .query("delete from cursorDiskKV where key like ?")
      .run(`bubbleId:${session.composerId}:%`);
  }

  mergeComposerHeads({
    database: input.workspaceDatabase,
    key: "composer.composerData",
    projectRoot: input.projectRoot,
    rendered: input.rendered,
    includeWorkspaceSelectionFields: true,
  });
  mergeComposerHeads({
    database: input.globalDatabase,
    key: "composer.composerHeaders",
    projectRoot: input.projectRoot,
    rendered: input.rendered,
    includeWorkspaceSelectionFields: false,
  });

  for (const session of input.rendered) {
    upsertKey(
      input.globalDatabase,
      "cursorDiskKV",
      `composerData:${session.composerId}`,
      JSON.stringify(session.composerData),
    );

    for (const bubble of session.bubbles) {
      upsertKey(
        input.globalDatabase,
        "cursorDiskKV",
        bubble.key,
        JSON.stringify(bubble.value),
      );
    }
  }

  mergeComposerPaneState(input.workspaceDatabase, input.rendered);

  return {
    composerRecordsWritten: input.rendered.length,
    bubblesWritten: input.rendered.reduce(
      (count, session) => count + session.bubbles.length,
      0,
    ),
    staleComposersRemoved,
  };
};

const mergeComposerHeads = (input: {
  database: Database;
  key: string;
  projectRoot: string;
  rendered: CursorRenderedSession[];
  includeWorkspaceSelectionFields: boolean;
}): void => {
  const desiredIds = new Set(
    input.rendered.map((session) => session.composerId),
  );
  const existing = parseJsonObject(
    queryKey(input.database, "ItemTable", input.key),
  );
  const existingHeads = Array.isArray(existing.allComposers)
    ? existing.allComposers.filter(isRecord)
    : [];
  const nextHeads = existingHeads.filter(
    (head) =>
      !isPokoImportForProject(head, input.projectRoot) ||
      (typeof head.composerId === "string" && desiredIds.has(head.composerId)),
  );

  for (const session of input.rendered) {
    const index = nextHeads.findIndex(
      (head) => head.composerId === session.composerId,
    );

    if (index >= 0) {
      nextHeads[index] = session.head;
    } else {
      nextHeads.push(session.head);
    }
  }

  nextHeads.sort(
    (left, right) =>
      numberValue(right.lastUpdatedAt) - numberValue(left.lastUpdatedAt),
  );

  const next: Record<string, unknown> = {
    ...existing,
    allComposers: nextHeads,
  };

  if (input.includeWorkspaceSelectionFields) {
    const firstDesired = input.rendered[0]?.composerId;
    next.selectedComposerIds = firstDesired
      ? [firstDesired]
      : (existing.selectedComposerIds ?? []);
    next.lastFocusedComposerIds = firstDesired
      ? [firstDesired]
      : (existing.lastFocusedComposerIds ?? []);
    next.hasMigratedComposerData = true;
    next.hasMigratedMultipleComposers = true;
  }

  upsertKey(input.database, "ItemTable", input.key, JSON.stringify(next));
};

const mergeComposerPaneState = (
  database: Database,
  rendered: CursorRenderedSession[],
): void => {
  if (rendered.length === 0) {
    return;
  }

  const key = "workbench.panel.composerChatViewPane";
  const existing = parseJsonObject(queryKey(database, "ItemTable", key));

  for (const session of rendered) {
    existing[`workbench.panel.aichat.view.${session.composerId}`] = {
      collapsed: false,
      isHidden: false,
      size: 800,
    };
  }

  upsertKey(database, "ItemTable", key, JSON.stringify(existing));
  upsertKey(
    database,
    "ItemTable",
    "workbench.panel.aichat.numberOfVisibleViews",
    String(rendered.length),
  );
};

const cleanupStalePokoCursorImports = (input: {
  database: Database;
  projectRoot: string;
  desiredIds: Set<string>;
}): number => {
  const rows = input.database
    .query(
      "select key, value from cursorDiskKV where key like 'composerData:%'",
    )
    .all() as Array<{ key: string; value: string }>;
  let removed = 0;

  for (const row of rows) {
    const data = parseJsonObject(row.value);

    if (!isPokoImportForProject(data, input.projectRoot)) {
      continue;
    }

    const composerId = String(
      data.composerId ?? row.key.replace("composerData:", ""),
    );

    if (input.desiredIds.has(composerId)) {
      continue;
    }

    input.database
      .query("delete from cursorDiskKV where key = ?")
      .run(`composerData:${composerId}`);
    input.database
      .query("delete from cursorDiskKV where key like ?")
      .run(`bubbleId:${composerId}:%`);
    removed += 1;
  }

  return removed;
};

const queryKey = (
  database: Database,
  table: "ItemTable" | "cursorDiskKV",
  key: string,
): string | undefined => {
  const row = database
    .query(`select value from ${table} where key = ?`)
    .get(key) as { value?: string } | undefined;

  return typeof row?.value === "string" ? row.value : undefined;
};

const upsertKey = (
  database: Database,
  table: "ItemTable" | "cursorDiskKV",
  key: string,
  value: string,
): void => {
  database
    .query(`insert or replace into ${table} (key, value) values (?, ?)`)
    .run(key, value);
};

const parseJsonObject = (
  value: string | undefined,
): Record<string, unknown> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const closeCursorForNativeSync = async (
  options: CursorNativeHistorySyncOptions,
): Promise<NativeAppLifecycle> =>
  closeAppForNativeSync({
    displayName: "Cursor",
    appNames: resolveCursorAppNames(),
    skipEnvVar: "POKO_CURSOR_SKIP_APP_LIFECYCLE",
    appController: options.appController,
    logger: options.logger,
  });

const reopenCursorAfterNativeSync = async (
  options: CursorNativeHistorySyncOptions,
  lifecycle: NativeAppLifecycle,
): Promise<void> =>
  reopenAppAfterNativeSync(
    {
      displayName: "Cursor",
      appNames: resolveCursorAppNames(),
      skipEnvVar: "POKO_CURSOR_SKIP_APP_LIFECYCLE",
      appController: options.appController,
      logger: options.logger,
    },
    lifecycle,
  );

const resolveCursorAppNames = (): string[] => {
  const names = [process.env.POKO_CURSOR_APP_NAME, "Cursor"].filter(
    (value): value is string => Boolean(value),
  );

  return [...new Set(names)];
};

const cursorBubbleId = (
  session: RawHistorySession,
  message: RawHistoryMessage,
  index: number,
): string =>
  deterministicUuid(
    `poko:cursor:bubble:${session.sourceAgent}:${session.id}:${message.id ?? index}:${message.role}`,
  );

const cursorToolBubbleId = (
  session: RawHistorySession,
  message: RawHistoryMessage,
  index: number,
  toolIndex: number,
  toolName: string,
): string =>
  deterministicUuid(
    `poko:cursor:tool-bubble:${session.sourceAgent}:${session.id}:${message.id ?? index}:${toolIndex}:${toolName}`,
  );

const cursorThinkingBubbleId = (
  session: RawHistorySession,
  message: RawHistoryMessage,
  index: number,
): string =>
  deterministicUuid(
    `poko:cursor:thinking-bubble:${session.sourceAgent}:${session.id}:${message.id ?? index}`,
  );

const cursorRichText = (text: string): string =>
  JSON.stringify({
    root: {
      children: text.split("\n").map((line) => ({
        children: line
          ? [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: line,
                type: "text",
                version: 1,
              },
            ]
          : [],
        direction: line ? "ltr" : null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      })),
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });

const emptyCursorRichText = (): string =>
  JSON.stringify({
    root: {
      children: [
        {
          children: [],
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
        },
      ],
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });

const emptyCursorContext = (): Record<string, unknown> => ({
  composers: [],
  selectedCommits: [],
  selectedPullRequests: [],
  selectedImages: [],
  selectedDocuments: [],
  selectedVideos: [],
  folderSelections: [],
  fileSelections: [],
  selections: [],
  terminalSelections: [],
  selectedDocs: [],
  externalLinks: [],
  cursorRules: [],
  cursorCommands: [],
  gitPRDiffSelections: [],
  subagentSelections: [],
  browserSelections: [],
  extraContext: [],
  mentions: {
    composers: {},
    selectedCommits: {},
    selectedPullRequests: {},
    gitDiff: [],
    gitDiffFromBranchToMain: [],
    selectedImages: {},
    folderSelections: {},
    fileSelections: {},
    terminalFiles: {},
    selections: {},
    terminalSelections: {},
    selectedDocs: {},
    externalLinks: {},
    diffHistory: [],
    cursorRules: {},
    cursorCommands: {},
    uiElementSelections: [],
    consoleLogs: [],
    ideEditorsState: [],
    gitPRDiffSelections: {},
    subagentSelections: {},
    browserSelections: {},
  },
});

const emptyCursorCapabilityStatuses = (): Record<string, unknown[]> => ({
  "mutate-request": [],
  "start-submit-chat": [],
  "before-submit-chat": [],
  "chat-stream-finished": [],
  "before-apply": [],
  "after-apply": [],
  "accept-all-edits": [],
  "composer-done": [],
  "process-stream": [],
  "add-pending-action": [],
});

const cursorProjectDir = (projectRoot: string): string =>
  path.join(
    process.env.POKO_CURSOR_PROJECTS_ROOT ??
      path.join(process.env.HOME ?? "", ".cursor", "projects"),
    projectRoot.replace(/^\/+/, "").replace(/[^a-zA-Z0-9._-]+/g, "-"),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPokoImportForProject = (
  value: Record<string, unknown>,
  projectRoot: string,
): boolean =>
  isRecord(value.pokoImport) &&
  value.pokoImport.originator === "poko" &&
  value.pokoImport.projectRoot === projectRoot;

const numberValue = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
