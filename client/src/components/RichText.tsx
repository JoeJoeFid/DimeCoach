import { useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface Props {
  value: string;
  onChange: (html: string) => void;
  ariaLabel: string;
}

/** Small rich text editor: bold, italic, underline and nested lists. Emits '' when empty. */
export default function RichText({ value, onChange, ariaLabel }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, code: false, blockquote: false, horizontalRule: false }),
    ],
    content: value,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { 'aria-label': ariaLabel, class: 'rt-content' } },
    onUpdate: ({ editor }) => onChangeRef.current(editor.isEmpty ? '' : editor.getHTML()),
  });
  if (!editor) return null;

  const btn = (label: string, title: string, active: boolean, run: () => void, cls = '') => (
    <button
      type="button"
      className={`rt-btn ${active ? 'on' : ''} ${cls}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => {
        e.preventDefault();
        run();
      }}
    >
      {label}
    </button>
  );
  const c = () => editor.chain().focus();

  return (
    <div className="rt">
      <div className="rt-bar">
        {btn('B', 'Bold', editor.isActive('bold'), () => c().toggleBold().run(), 'b')}
        {btn('I', 'Italic', editor.isActive('italic'), () => c().toggleItalic().run(), 'i')}
        {btn('U', 'Underline', editor.isActive('underline'), () => c().toggleUnderline().run(), 'u')}
        <span className="rt-sep" />
        {btn('• List', 'Bulleted list', editor.isActive('bulletList'), () => c().toggleBulletList().run())}
        {btn('1. List', 'Numbered list', editor.isActive('orderedList'), () => c().toggleOrderedList().run())}
        {btn('→', 'Indent list item (Tab)', false, () => c().sinkListItem('listItem').run())}
        {btn('←', 'Outdent list item (Shift+Tab)', false, () => c().liftListItem('listItem').run())}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
