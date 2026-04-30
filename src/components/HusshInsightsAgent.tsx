/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hussh Insights AI — floating metrics agent for the Hussh Matrix Dashboard.
 * Apple-inspired glassmorphism design with smooth animations.
 */

import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Lightbulb, Loader2, MessageSquareText, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

interface AgentClaim {
  product: string;
  metric: string;
  label: string;
  value: number | string | null;
  unit: string;
  source: string;
  range?: {
    startDate: string;
    endDate: string;
    days: number;
  };
}

interface AgentSource {
  product: string;
  source: string;
  status: string;
  available: boolean;
}

interface ChatResponse {
  reply: string;
  claims?: AgentClaim[];
  sources?: AgentSource[];
  warnings?: string[];
  confidence?: 'high' | 'medium' | 'low';
  suggestedQuestions?: string[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  claims?: AgentClaim[];
  sources?: AgentSource[];
  warnings?: string[];
  confidence?: 'high' | 'medium' | 'low';
  suggestedQuestions?: string[];
  isError?: boolean;
}

interface PromptOption {
  label: string;
  prompt: string;
  tone?: 'default' | 'priority' | 'warning';
}

const STARTER_PROMPTS: PromptOption[] = [
  {
    label: 'All-product users',
    prompt: 'How many users does Hushh have across all products? Explain what is counted and what is not counted.',
    tone: 'priority',
  },
  {
    label: 'Top 3 issues',
    prompt: 'What are the top 3 issues across the dashboard right now? Give complete items with source evidence.',
  },
  {
    label: 'Kai prod vs UAT',
    prompt: 'Compare kai.hushh.ai production and uat.kai.hushh.ai UAT. Keep production and UAT separate.',
  },
  {
    label: 'Growth summary',
    prompt: 'Give me a growth summary for hushh.ai, hushhtech.com, kai production, and Kai UAT for the selected range.',
  },
];

const DEEP_DIVE_PROMPTS: PromptOption[] = [
  {
    label: 'Full board review',
    prompt: 'Review the full dashboard like an operator. Give me wins, risks, missing data, and the next 5 actions.',
    tone: 'priority',
  },
  {
    label: 'What changed today?',
    prompt: 'What changed today across Hushh products? Separate traffic, users, funnels, reliability, and data freshness.',
  },
  {
    label: 'Source health audit',
    prompt: 'Audit every connected source. Tell me what is live, delayed, waiting, not configured, and what each status means.',
    tone: 'warning',
  },
  {
    label: 'CEO brief',
    prompt: 'Create a concise CEO-ready brief from the current metrics with the most important numbers and caveats.',
  },
];

const BASE_FOLLOW_UPS: PromptOption[] = [
  {
    label: 'Recommended actions',
    prompt: 'Based on the last answer, give me the recommended next actions in priority order.',
    tone: 'priority',
  },
  {
    label: 'Source caveats',
    prompt: 'Show the source caveats behind the last answer. What is live, delayed, waiting, or unavailable?',
  },
  {
    label: 'Exact numbers',
    prompt: 'Convert the last answer into exact metric claims with product, source, date range, and confidence.',
  },
  {
    label: 'Executive summary',
    prompt: 'Rewrite the last answer as a short executive summary with only the decision-relevant points.',
  },
];

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function renderBoldText(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${part}-${index}`} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function renderMessageContent(content: string) {
  return content.split('\n').map((line, index) => (
    <span key={`${line}-${index}`} className="block">
      {renderBoldText(line)}
    </span>
  ));
}

function confidenceClass(confidence: ChatMessage['confidence']) {
  if (confidence === 'high') return 'border-[#1f7a36]/15 bg-[#ecfdf3] text-[#1f7a36]';
  if (confidence === 'low') return 'border-[#9a5b00]/15 bg-[#fff7e6] text-[#9a5b00]';
  return 'border-[#005eb8]/15 bg-[#e8f2ff] text-[#005eb8]';
}

function statusClass(status: string, available: boolean) {
  if (available || status === 'live' || status === 'near_live') return 'border-[#1f7a36]/15 bg-[#ecfdf3] text-[#1f7a36]';
  if (status === 'delayed') return 'border-[#005eb8]/15 bg-[#e8f2ff] text-[#005eb8]';
  return 'border-[#9a5b00]/15 bg-[#fff7e6] text-[#9a5b00]';
}

function promptOptionClass(tone: PromptOption['tone'] = 'default') {
  if (tone === 'priority') return 'border-[#007aff]/20 bg-[#eef6ff] text-[#005eb8] hover:border-[#007aff]/35 hover:bg-[#e3f1ff]';
  if (tone === 'warning') return 'border-[#9a5b00]/20 bg-[#fff7e6] text-[#7a4b00] hover:border-[#9a5b00]/35 hover:bg-[#fff1d2]';
  return 'border-black/[0.06] bg-[#f5f5f7]/90 text-[#1d1d1f] hover:border-[#007aff]/20 hover:bg-[#007aff]/[0.05] hover:text-[#005eb8]';
}

function buildContextualPrompts(message: ChatMessage | undefined): PromptOption[] {
  if (!message || message.role !== 'assistant' || message.isError) return STARTER_PROMPTS;

  const serverPrompts = (message.suggestedQuestions ?? []).map((question) => ({
    label: question.length > 32 ? `${question.slice(0, 29)}...` : question,
    prompt: question,
    tone: 'priority' as const,
  }));
  const prompts = [...serverPrompts, ...BASE_FOLLOW_UPS];
  const sources = message.sources ?? [];
  const warnings = message.warnings ?? [];
  const sourceText = sources.map((source) => `${source.product} ${source.source} ${source.status}`).join(' ').toLowerCase();
  const warningText = warnings.join(' ').toLowerCase();

  if (sourceText.includes('cloud') || message.content.toLowerCase().includes('request')) {
    prompts.push({
      label: 'Reliability trend',
      prompt: 'Show the Cloud Run request, non-2xx, error-rate, and p95 latency trend behind the last answer.',
    });
  }

  if (sourceText.includes('kai') || message.content.toLowerCase().includes('kai')) {
    prompts.push({
      label: 'Kai split',
      prompt: 'Break this down separately for kai.hushh.ai production and uat.kai.hushh.ai UAT.',
      tone: 'priority',
    });
  }

  if (warningText.includes('waiting') || warningText.includes('unavailable') || warningText.includes('not configured')) {
    prompts.push({
      label: 'Fix missing data',
      prompt: 'What exactly is missing or waiting in the last answer, and what should we configure next?',
      tone: 'warning',
    });
  }

  return prompts.slice(0, 6);
}

function PromptOptionTray({
  title,
  options,
  disabled,
  onSelect,
}: {
  title: string;
  options: PromptOption[];
  disabled: boolean;
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#86868b]">
        <Lightbulb className="h-3 w-3" />
        {title}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {options.map((option) => (
          <button
            key={`${title}-${option.label}`}
            type="button"
            onClick={() => onSelect(option.prompt)}
            disabled={disabled}
            title={option.prompt}
            className={`min-h-8 shrink-0 rounded-full border px-3 text-left text-[11px] font-bold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${promptOptionClass(option.tone)}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function HusshInsightsAgent() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastAssistantMessage = [...messages].reverse().find((msg) => msg.role === 'assistant' && !msg.isError);
  const recommendedPrompts = useMemo(() => buildContextualPrompts(lastAssistantMessage), [lastAssistantMessage]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && !isLoading) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen, isLoading]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMessage: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setHasError(false);

    try {
      const history = messages
        .filter((msg) => !msg.isError)
        .map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(errorData.error || `Request failed with status ${response.status}`);
      }

      const data = await response.json() as ChatResponse;

      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: data.reply,
        timestamp: new Date(),
        claims: data.claims ?? [],
        sources: data.sources ?? [],
        warnings: data.warnings ?? [],
        confidence: data.confidence,
        suggestedQuestions: data.suggestedQuestions ?? [],
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setHasError(true);
      const errorMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
        timestamp: new Date(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, messages]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }, [input, sendMessage]);

  const handleSuggestion = useCallback((prompt: string) => {
    sendMessage(prompt);
  }, [sendMessage]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setHasError(false);
  }, []);

  return (
    <>
      {/* Floating Action Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 24 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#1d1d1f] shadow-[0_2px_8px_rgba(0,0,0,0.12),0_12px_32px_rgba(0,0,0,0.18)] transition-shadow duration-200 hover:shadow-[0_4px_12px_rgba(0,0,0,0.16),0_16px_40px_rgba(0,0,0,0.24)] active:scale-95"
            aria-label="Open Hussh Insights AI"
          >
            <Sparkles className="h-6 w-6 text-white" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="fixed bottom-6 right-6 z-50 flex w-[400px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white/92 shadow-[0_4px_16px_rgba(0,0,0,0.08),0_24px_64px_rgba(0,0,0,0.12)] backdrop-blur-2xl sm:w-[480px]"
            style={{ maxHeight: 'min(760px, calc(100vh - 48px))' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-black/[0.06] bg-white/60 px-5 py-3.5 backdrop-blur-xl">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#007aff] to-[#5856d6]">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h2 className="text-[13px] font-bold text-[#1d1d1f] leading-tight">Hussh Insights AI</h2>
                  <p className="text-[11px] font-medium text-[#86868b] leading-tight">Metrics agent</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={clearChat}
                    className="rounded-lg px-2 py-1 text-[11px] font-semibold text-[#86868b] transition-colors hover:bg-black/[0.04] hover:text-[#1d1d1f]"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/[0.06]"
                  aria-label="Close"
                >
                  <X className="h-4 w-4 text-[#86868b]" />
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4" style={{ minHeight: '300px', maxHeight: '510px' }}>
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center py-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#007aff]/10 to-[#5856d6]/10">
                    <Sparkles className="h-6 w-6 text-[#007aff]" />
                  </div>
                  <p className="mb-1 text-[15px] font-bold text-[#1d1d1f]">Choose a starting point</p>
                  <p className="mb-5 text-center text-[13px] text-[#86868b] leading-relaxed">
                    Pick a recommended analyst question or type your own.<br />
                    I keep source status, caveats, and confidence attached.
                  </p>
                  <div className="flex w-full flex-col gap-2">
                    {DEEP_DIVE_PROMPTS.map((option) => (
                      <button
                        key={option.label}
                        onClick={() => handleSuggestion(option.prompt)}
                        className={`group flex w-full items-start gap-2 rounded-xl border px-3.5 py-2.5 text-left transition-all duration-150 active:scale-[0.98] ${promptOptionClass(option.tone)}`}
                      >
                        <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          <span className="block text-[12px] font-bold">{option.label}</span>
                          <span className="mt-0.5 block text-[11px] font-medium leading-snug opacity-75">{option.prompt}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-[#007aff] text-white'
                            : msg.isError || (hasError && msg === messages[messages.length - 1])
                              ? 'border border-red-200/60 bg-red-50/80 text-[#1d1d1f]'
                              : 'border border-black/[0.04] bg-[#f5f5f7]/80 text-[#1d1d1f]'
                        }`}
                      >
                        {msg.role === 'assistant' ? (
                          <div className="space-y-2">
                            <div className="space-y-1">{renderMessageContent(msg.content)}</div>
                            {!msg.isError && (
                              <div className="space-y-2 pt-1">
                                <div className="flex flex-wrap gap-1.5">
                                  {msg.confidence && (
                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${confidenceClass(msg.confidence)}`}>
                                      {msg.confidence}
                                    </span>
                                  )}
                                  {(msg.sources ?? []).slice(0, 4).map((source) => (
                                    <span
                                      key={`${msg.id}-${source.product}-${source.source}`}
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(source.status, source.available)}`}
                                      title={`${source.product}: ${source.source}`}
                                    >
                                      {source.source.replaceAll('_', ' ')}
                                    </span>
                                  ))}
                                </div>
                                {(msg.warnings ?? []).length > 0 && (
                                  <div className="rounded-lg border border-[#9a5b00]/15 bg-[#fff7e6]/70 px-2.5 py-2 text-[11px] font-medium leading-snug text-[#7a4b00]">
                                    {msg.warnings?.slice(0, 2).join(' ')}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          msg.content
                        )}
                      </div>
                    </motion.div>
                  ))}

                  {isLoading && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex justify-start"
                    >
                      <div className="flex items-center gap-2 rounded-2xl border border-black/[0.04] bg-[#f5f5f7]/80 px-3.5 py-2.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#007aff]" />
                        <span className="text-[12px] text-[#86868b]">Analyzing metrics…</span>
                      </div>
                    </motion.div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="border-t border-black/[0.06] bg-white/60 px-4 py-3 backdrop-blur-xl">
              <div className="mb-3 rounded-xl border border-black/[0.05] bg-white/70 px-3 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
                <PromptOptionTray
                  title={messages.length === 0 ? 'Recommended questions' : 'Suggested next'}
                  options={recommendedPrompts}
                  disabled={isLoading}
                  onSelect={handleSuggestion}
                />
              </div>
              <div className="flex items-end gap-2 rounded-xl border border-black/[0.08] bg-white px-3 py-2 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-shadow focus-within:border-[#007aff]/30 focus-within:shadow-[0_0_0_3px_rgba(0,122,255,0.1)]">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about Hushh metrics…"
                  rows={1}
                  disabled={isLoading}
                  className="max-h-[120px] min-h-[24px] flex-1 resize-none bg-transparent text-[13px] text-[#1d1d1f] placeholder-[#86868b]/70 outline-none disabled:opacity-50"
                  style={{ lineHeight: '1.5' }}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isLoading}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#007aff] text-white transition-all duration-150 hover:bg-[#0066d6] disabled:bg-[#d1d1d6] disabled:text-white active:scale-90"
                  aria-label="Send message"
                >
                  <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] text-[#86868b]/60">
                Hussh Insights AI has full access to your metrics matrix
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
