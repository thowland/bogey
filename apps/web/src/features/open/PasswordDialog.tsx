// The password dialog (D3): shown while the open sequence waits for a password, and again after a
// wrong one. The password goes to the open sequence and is never stored.
import { useId, useState, type FormEvent } from 'react';
import { useDocumentStore } from '../../state/document.ts';
import { Button } from '../../ui/Button.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { messageFor } from '../../ui/messages.ts';
import { answerPassword } from './passwordPrompt.ts';
import styles from './PasswordDialog.module.css';

export function PasswordDialog() {
  const open = useDocumentStore((state) => state.status === 'password');
  const problem = useDocumentStore((state) => state.problem);
  const name = useDocumentStore((state) => state.name);
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(false);
  const inputId = useId();
  const formId = useId();

  // Each new question (the first, or after a wrong password) clears and re-enables the dialog.
  const [question, setQuestion] = useState(problem);
  if (question !== problem) {
    setQuestion(problem);
    setChecking(false);
    setPassword('');
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password === '' || checking) return;
    setChecking(true);
    answerPassword(password);
  };

  return (
    <Dialog
      open={open}
      title="Password required"
      onClose={() => answerPassword(null)}
      actions={
        <>
          <Button onClick={() => answerPassword(null)}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={password === '' || checking}
          >
            {checking ? 'Checking…' : 'Open'}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} onSubmit={submit}>
        {name && <p className={styles.name}>{name}</p>}
        {problem && (
          <p
            className={problem.code === 'pdf.password-wrong' ? styles.error : undefined}
            role={problem.code === 'pdf.password-wrong' ? 'alert' : undefined}
          >
            {messageFor(problem)}
          </p>
        )}
        <label htmlFor={inputId}>Password</label>
        <input
          id={inputId}
          className={styles.input}
          type="password"
          autoComplete="off"
          // The dialog exists to take this one input.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={password}
          disabled={checking}
          onChange={(event) => setPassword(event.target.value)}
        />
      </form>
    </Dialog>
  );
}
