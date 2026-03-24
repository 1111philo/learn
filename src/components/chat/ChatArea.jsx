import { useRef, useEffect } from 'react';

export default function ChatArea({ children }) {
  const ref = useRef(null);
  const prevChildCount = useRef(0);

  useEffect(() => {
    // Scroll to bottom when content changes
    if (ref.current) {
      requestAnimationFrame(() => {
        if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
      });
    }
  });

  return (
    <div className="chat" role="log" aria-label="Course conversation" ref={ref}>
      {children}
    </div>
  );
}
