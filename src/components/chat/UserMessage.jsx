import { esc } from '../../lib/helpers.js';

export default function UserMessage({ content, label }) {
  return (
    <div className="msg msg-user">
      <p>{label && <strong>{label}: </strong>}{content}</p>
    </div>
  );
}
