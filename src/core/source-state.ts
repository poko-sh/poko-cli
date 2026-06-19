import path from "node:path";
import { type PokoContext, pathExists } from "./config.ts";

export type SourceState = "missing" | "empty" | "present";

export const sourceState = async (
  context: PokoContext,
  fileName: string,
  content: string,
): Promise<SourceState> => {
  const present = await pathExists(path.join(context.pokoDir, fileName));

  if (!present) {
    return "missing";
  }

  return content.trim().length > 0 ? "present" : "empty";
};
