"use client";
import { Children, isValidElement, ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CopyButton } from "./ui";

function plainText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child): string =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? plainText(child.props.children)
          : "",
    )
    .join("");
}

export default function MarkdownOutput({
  text,
  notify,
}: {
  text: string;
  notify: (message: string) => void;
}) {
  return (
    <div className="markdown-output">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        skipHtml
        disallowedElements={["img"]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          pre: ({ children }) => (
            <div className="code-block">
              <div className="code-toolbar">
                <span>Code</span>
                <CopyButton
                  value={plainText(children).replace(/\n$/, "")}
                  label="Copy code"
                  onCopy={notify}
                />
              </div>
              <pre>{children}</pre>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
