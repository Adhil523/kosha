import { cn } from '@/lib/utils';

type CodeBlockProps = {
  title: string;
  lines: readonly string[];
  /** The one line the card is about (1-based): it carries the fragment's single accent */
  mark?: number;
  className?: string;
};

const isComment = (line: string) => line.trimStart().startsWith('//');

/** A file as the product's users see it: a title bar, line numbers, comments in grey */
export const CodeBlock = ({ title, lines, mark, className }: CodeBlockProps) => (
  <div className={cn('ui overflow-hidden', className)} aria-hidden="true">
    <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 font-mono text-ui-meta text-muted">
      <span className="flex gap-1.5">
        <i className="size-2.5 rounded-full bg-line-strong" />
        <i className="size-2.5 rounded-full bg-line-strong" />
        <i className="size-2.5 rounded-full bg-line-strong" />
      </span>
      {title}
    </div>
    <pre className="py-4 font-mono text-ui leading-[1.6]">
      {lines.map((line, index) => (
        <span
          key={index}
          className={cn(
            'flex gap-4 border-l-2 border-transparent pr-4 pl-[14px]',
            isComment(line) && 'text-muted',
            index + 1 === mark && 'border-accent bg-accent/8'
          )}
        >
          <span className="w-4 shrink-0 text-right text-muted select-none">{index + 1}</span>
          <span className="whitespace-pre">{line}</span>
        </span>
      ))}
    </pre>
  </div>
);
