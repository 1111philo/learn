import { useRef, useEffect, forwardRef } from 'react';

const ChatArea = forwardRef(function ChatArea({ children }, ref) {
  const localRef = useRef(null);
  const scrollRef = ref || localRef;

  useEffect(() => {
    // Scroll to bottom when content changes
    const el = typeof scrollRef === 'function' ? null : scrollRef.current;
    if (el) {
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  });

  return (
    <div className="chat" role="log" aria-label="Course conversation" ref={scrollRef}>
      {children}
    </div>
  );
});

export default ChatArea;
