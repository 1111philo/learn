import { useState, useEffect, useRef } from 'react';

/**
 * Smoothly reveals streamed text at a steady cadence.
 * Takes the raw accumulated text from the API and returns
 * the portion to display, draining ~2 chars every 15ms (~130 chars/sec).
 *
 * When rawText is null, resets and returns null (stream not active).
 */
export function useStreamedText(rawText) {
  const [display, setDisplay] = useState(null);
  const bufferRef = useRef('');
  const posRef = useRef(0);

  // Update buffer when new text arrives
  useEffect(() => {
    if (rawText == null) {
      bufferRef.current = '';
      posRef.current = 0;
      setDisplay(null);
      return;
    }
    bufferRef.current = rawText;
  }, [rawText]);

  // Drain buffer at a steady pace
  useEffect(() => {
    if (rawText == null) return;

    const timer = setInterval(() => {
      const target = bufferRef.current;
      if (posRef.current < target.length) {
        // Advance one character at a time
        posRef.current++;
        setDisplay(target.slice(0, posRef.current));
      }
    }, 30);

    return () => clearInterval(timer);
  }, [rawText != null]); // only start/stop when streaming starts/ends

  return display;
}
