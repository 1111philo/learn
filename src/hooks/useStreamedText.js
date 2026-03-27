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
        // Advance by 2 chars (or to end of current word for smoother feel)
        let next = posRef.current + 2;
        // Snap to end of word if close
        while (next < target.length && target[next] !== ' ' && next - posRef.current < 6) {
          next++;
        }
        posRef.current = Math.min(next, target.length);
        setDisplay(target.slice(0, posRef.current));
      }
    }, 15);

    return () => clearInterval(timer);
  }, [rawText != null]); // only start/stop when streaming starts/ends

  return display;
}
