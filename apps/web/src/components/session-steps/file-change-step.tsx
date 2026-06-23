"use client";

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block";
import { FileIcon } from "lucide-react";

export function FileChangeStep({
  path,
  changeType,
  diff,
}: {
  path: string;
  changeType: string;
  diff: string;
}) {
  return (
    <CodeBlock code={diff} language="diff">
      <CodeBlockHeader>
        <CodeBlockTitle>
          <FileIcon size={14} />
          <CodeBlockFilename>
            {path} ({changeType})
          </CodeBlockFilename>
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton />
        </CodeBlockActions>
      </CodeBlockHeader>
    </CodeBlock>
  );
}
