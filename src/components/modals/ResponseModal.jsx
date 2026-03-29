import { useState, useRef } from 'react';
import { useModal } from '../../contexts/ModalContext.jsx';
import { useAutoResize } from '../../hooks/useAutoResize.js';

/**
 * Modal for submitting work — text, image upload, or both.
 */
export default function ResponseModal({ onSubmit }) {
  const { hide } = useModal();
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const handleResize = useAutoResize(400);

  const hasContent = text.trim() || image;

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImage({ dataUrl: reader.result, name: file.name });
    };
    reader.readAsDataURL(file);
  };

  const submit = () => {
    if (!hasContent) return;
    hide();
    onSubmit({ text: text.trim() || null, screenshot: image });
  };

  return (
    <>
      <h2>Complete Activity</h2>

      <textarea
        ref={inputRef}
        className="modal-textarea"
        rows={6}
        placeholder="Write your response..."
        value={text}
        onChange={(e) => { setText(e.target.value); handleResize(e); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') hide();
        }}
        autoFocus
      />

      {image ? (
        <div className="compose-preview" style={{ marginBottom: '8px' }}>
          <img src={image.dataUrl} alt={image.name || 'Uploaded'} className="compose-preview-img" />
          <button className="compose-preview-remove" onClick={() => setImage(null)} aria-label="Remove">&times;</button>
        </div>
      ) : (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="sr-only"
            aria-label="Upload image"
          />
          <button
            className="secondary-btn"
            style={{ width: '100%', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            onClick={() => fileRef.current?.click()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Upload Image
          </button>
        </>
      )}

      <div className="action-bar">
        <button className="secondary-btn" onClick={hide}>Cancel</button>
        <button className="primary-btn" onClick={submit} disabled={!hasContent}>Submit</button>
      </div>
    </>
  );
}
