import { Fragment, type ReactNode } from 'react';
import { parseNotebookMarkdown, type MdInline } from '../lib/notebook-markdown';

function renderInline(nodes: MdInline[], keyPrefix = 'i'): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case 'text':
        // Newlines inside a paragraph become line breaks; the text itself is rendered as text.
        return (
          <Fragment key={key}>
            {node.text.split('\n').map((line, i) => (
              <Fragment key={i}>
                {i > 0 ? <br /> : null}
                {line}
              </Fragment>
            ))}
          </Fragment>
        );
      case 'strong':
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case 'em':
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case 'code':
        return <code key={key}>{node.text}</code>;
      case 'link': {
        const external = !node.href.startsWith('/');
        return (
          <a key={key} href={node.href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {renderInline(node.children, key)}
          </a>
        );
      }
    }
  });
}

/** Renders a notebook text block. Only React elements are produced (no innerHTML). */
export function NotebookMarkdown({ source }: { source: string }) {
  const blocks = parseNotebookMarkdown(source);
  return (
    <div className="notebook-markdown">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading': {
            const Tag = (['h2', 'h3', 'h4'] as const)[block.level - 1]!;
            return <Tag key={index}>{renderInline(block.children)}</Tag>;
          }
          case 'paragraph':
            return <p key={index}>{renderInline(block.children)}</p>;
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag key={index}>
                {block.items.map((item, i) => (
                  <li key={i}>{renderInline(item, `${index}-${i}`)}</li>
                ))}
              </Tag>
            );
          }
          case 'quote':
            return <blockquote key={index}>{renderInline(block.children)}</blockquote>;
          case 'code':
            return (
              <pre key={index}>
                <code>{block.text}</code>
              </pre>
            );
          case 'hr':
            return <hr key={index} />;
        }
      })}
    </div>
  );
}
