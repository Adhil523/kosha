import { cn } from '@/lib/utils';

type CodeBlockProps = {
  title: string;
  lines: readonly string[];
  className?: string;
};

const isComment = (line: string) => line.trimStart().startsWith('//');

/** A file as the product's users see it: a title bar, line numbers, comments in grey */
export const CodeBlock = ({ title, lines, className }: CodeBlockProps) => (
  <div className={cn('ui overflow-hidden', className)} aria-hidden="true">
    <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 font-mono text-ui-meta text-muted">
      <span className="flex gap-1.5">
        <i className="size-2.5 rounded-full bg-line-strong" />
        <i className="size-2.5 rounded-full bg-line-strong" />
        <i className="size-2.5 rounded-full bg-line-strong" />
      </span>
      {title}
    </div>
    <pre className="p-4 font-mono text-ui leading-[1.6]">
      {lines.map((line, index) => (
        <span key={index} className={cn('flex gap-4', isComment(line) && 'text-muted')}>
          <span className="w-4 shrink-0 text-right text-muted select-none">{index + 1}</span>
          <span className="whitespace-pre">{line}</span>
        </span>
      ))}
    </pre>
  </div>
);
