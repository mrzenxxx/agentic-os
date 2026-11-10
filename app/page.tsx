"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ChatMessageView, messageEvents, messageResult, stageLabels } from "@/components/chat/message";
import { ChatIcon } from "@/components/chat/icons";
import type { ChatMessage } from "@/src/chat/types";
import styles from "@/components/chat/chat.module.css";

const suggestions = ["Предложи ужин с высоким белком без молочки", "Составь план домашних тренировок на неделю"];

export default function Page() {
  const [transport] = useState(() => new DefaultChatTransport<ChatMessage>({
    api: "/api/chat",
    prepareSendMessagesRequest: ({ messages }) => ({
      // Чат хранит историю в памяти, но каждый запуск обрабатывает новую задачу.
      body: { messages: messages.slice(-1).map((message) => ({
        role: message.role,
        parts: message.parts.filter((part) => part.type === "text").map((part) => ({ type: "text", text: part.text })),
      })) },
    }),
  }));
  const { messages, sendMessage, status, error, clearError } = useChat<ChatMessage>({ transport, throttle: 40 });
  const [input, setInput] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const sending = useRef(false);
  const running = status === "submitted" || status === "streaming";

  useEffect(() => {
    const container = scroller.current;
    const thread = content.current;
    if (!container || !thread) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (follow.current) container.scrollTop = container.scrollHeight;
      });
    });
    observer.observe(thread);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    if (!running) textarea.current?.focus({ preventScroll: true });
  }, [running]);

  function onScroll() {
    const container = scroller.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    follow.current = nearBottom;
    setAtBottom(nearBottom);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running || sending.current) return;
    const text = input.trim();
    if (!text) { setFieldError("Введите задачу для коуча."); textarea.current?.focus(); return; }
    sending.current = true;
    follow.current = true;
    setAtBottom(true);
    setFieldError(null);
    clearError();
    setInput("");
    try { await sendMessage({ text }); }
    finally { sending.current = false; }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const lastMessage = messages.at(-1);
  const lastAssistant = lastMessage?.role === "assistant" ? lastMessage : undefined;
  const latestStage = lastAssistant ? messageEvents(lastAssistant).reverse().find((event) => event.type === "stage" && event.status === "running") : undefined;
  const result = lastAssistant ? messageResult(lastAssistant) : undefined;
  const announcement = error ? "Запуск завершился ошибкой" : running
    ? latestStage?.type === "stage" ? stageLabels[latestStage.stage] : "Агент работает"
    : result?.review.verdict === "needs_human_professional" ? "Требуется специалист"
    : result ? `Запуск завершён: ${result.review.verdict}, ${result.finalScore ?? result.review.score} из 10` : "";

  return (
    <main id="main" className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brandIcon}><ChatIcon name="coach" /></span>
        <div><h1>Health Coach</h1><p>Питание, движение и восстановление</p></div>
        <span className={styles.sessionNote}>План с проверкой безопасности</span>
      </header>

      <div className={styles.conversation} ref={scroller} onScroll={onScroll} tabIndex={0} aria-label="Переписка с коучем">
        <div className={styles.thread} ref={content}>
          {messages.length === 0 && <section className={styles.empty}>
            <ChatIcon name="coach" />
            <h2>С чего начнём сегодня?</h2>
            <p>Опишите задачу. Коуч учтёт профиль и дневник, найдёт знания и проверит план перед ответом.</p>
            <div className={styles.suggestions}>{suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => { setInput(suggestion); textarea.current?.focus(); }}>{suggestion}</button>)}</div>
          </section>}
          {messages.map((message, index) => <ChatMessageView key={message.id} message={message} active={running && index === messages.length - 1 && message.role === "assistant"} failed={status === "error" && index === messages.length - 1} />)}
          {status === "submitted" && !lastAssistant && <p className={styles.pending}>Подключаю инструменты…</p>}
          {error && <p className={styles.error}>Не удалось завершить запуск. Проверьте настройки и отправьте задачу ещё раз.</p>}
          {!atBottom && <button type="button" className={styles.jumpButton} onClick={() => {
            follow.current = true;
            setAtBottom(true);
            scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "instant" });
          }}><ChatIcon name="arrow" />К последнему сообщению</button>}
        </div>
      </div>

      <div className={styles.composerArea}>
        <div className={styles.composerInner}>
          <form onSubmit={submit} aria-busy={running}>
            <label htmlFor="chat-task" className={styles.composerLabel}>Задача для коуча</label>
            <div className={styles.composer}>
              <textarea id="chat-task" name="task" ref={textarea} value={input} onChange={(event) => { setInput(event.target.value); setFieldError(null); }} onKeyDown={onKeyDown} disabled={running} rows={2} maxLength={8000} placeholder="Например, предложи простой ужин…" aria-invalid={!!fieldError} aria-describedby={fieldError ? "chat-error chat-hint" : "chat-hint"} />
              <button type="submit" className={styles.sendButton} disabled={running} aria-label={running ? "Агент работает" : "Отправить задачу"}>{running ? <span className={styles.spinner} /> : <ChatIcon name="send" />}</button>
            </div>
            {fieldError && <p id="chat-error" className={styles.error} role="alert">{fieldError}</p>}
            <p id="chat-hint" className={styles.composerHint}>Enter — отправить · Shift + Enter — новая строка. История до обновления страницы; каждый запрос — отдельный запуск.</p>
          </form>
        </div>
      </div>
      <div className={styles.srOnly} role="status" aria-atomic="true">{announcement}</div>
    </main>
  );
}
