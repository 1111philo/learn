import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface MarkdownRendererProps {
  content: string;
}

// Shift markdown headings down one level so h1 in content becomes h2, etc.
// This preserves correct heading hierarchy when the page already has an h1 title.
const headingComponents = {
  h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 {...props}>{children}</h2>,
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 {...props}>{children}</h3>,
  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h4 {...props}>{children}</h4>,
  h4: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h5 {...props}>{children}</h5>,
  h5: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h6 {...props}>{children}</h6>,
  h6: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h6 {...props}>{children}</h6>,
};

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose prose-neutral prose-sm sm:prose-base max-w-none">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={headingComponents}>
        {content}
      </Markdown>
    </div>
  );
}
