import { createHash } from "node:crypto";
import path from "node:path";
import {
  type CursorWorkspace,
  cursorFileUri,
  cursorWorkspaceIdentifier,
} from "../cursor-storage.ts";
import { sourceLineageId } from "../lineage.ts";
import type { RawHistoryMessage, RawHistorySession } from "../types.ts";
import {
  conversationMessages,
  deterministicUuid,
  messageDate,
  sessionCreatedDate,
  sessionUpdatedDate,
  timestampMs,
  truncate,
} from "./common.ts";
import {
  CURSOR_CONTINUATION_MESSAGE_LIMIT,
  CURSOR_IMPORT_MODEL,
  type CursorFileRef,
  type CursorMessageAnnotations,
  type CursorRenderedBubble,
  type CursorRenderedSession,
  type CursorSessionRenderInput,
  type CursorToolUse,
} from "./cursor-types.ts";

export const renderCursorImportSessions = (
  input: Omit<
    CursorSessionRenderInput,
    | "importKind"
    | "composerIdSuffix"
    | "titlePrefix"
    | "messageLimit"
    | "readOnly"
    | "continuation"
  >,
): CursorRenderedSession[] => {
  if (input.session.sourceAgent === "cursor") {
    return [
      renderCursorSession({
        ...input,
        importKind: "native",
      }),
    ];
  }

  return [
    renderCursorSession({
      ...input,
      importKind: "archive",
      composerIdSuffix: "archive",
      titlePrefix: "[History] ",
      readOnly: true,
    }),
    renderCursorSession({
      ...input,
      importKind: "continuation",
      composerIdSuffix: "continue",
      titlePrefix: "Continue: ",
      messageLimit: CURSOR_CONTINUATION_MESSAGE_LIMIT,
      continuation: true,
    }),
  ];
};

const renderCursorSession = (
  input: CursorSessionRenderInput,
): CursorRenderedSession => {
  const composerId = deterministicUuid(
    `poko:cursor:composer:${input.composerIdSuffix ?? "native"}:${input.session.sourceAgent}:${input.session.id}`,
  );
  const created = sessionCreatedDate(input.session, input.fallbackDate);
  const updated = sessionUpdatedDate(input.session, created);
  const createdMs = timestampMs(created);
  const updatedMs = timestampMs(updated);
  const baseTitle = input.session.title || "Poko import";
  const title = truncate(`${input.titlePrefix ?? ""}${baseTitle}`, 80);
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
    ...(input.readOnly ? { readOnly: true } : {}),
    ...(input.continuation ? { continuation: true } : {}),
  };
  const allMessages = conversationMessages(input.session);
  const messages =
    input.messageLimit && input.messageLimit > 0
      ? allMessages.slice(-input.messageLimit)
      : allMessages;
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
    importKind: input.importKind,
    composerData: {
      _v: 16,
      agentBackend: "cursor-agent",
      composerId,
      richText: emptyCursorRichText(),
      hasLoaded: true,
      text: "",
      fullConversationHeadersOnly: headers,
      conversationMap: {},
      status: "none",
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
      subtitle: input.continuation
        ? `Continue from ${input.session.sourceAgent} (${messages.length} recent message(s))`
        : `${allMessages.length} imported message(s) from ${input.session.sourceAgent}`,
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
