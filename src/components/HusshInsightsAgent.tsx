/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Matrix Agent One — floating metrics analyst for the Hussh Matrix Dashboard.
 * Apple-inspired material design with smooth animations.
 */

import { AnimatePresence, motion } from 'motion/react';
import { Activity, ArrowUp, Lightbulb, Loader2, MessageSquareText, Sparkles, Trash2, X } from 'lucide-react';
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

interface AgentKnowledgeSource {
  id: string;
  title: string;
  category: 'metric_definition' | 'source_caveat' | 'runbook' | 'dashboard_context';
}

export interface MatrixAgentContext {
  activeView?: 'overview' | 'platforms';
  focusedProduct?: 'hushh.ai' | 'uat.hushh.ai' | 'kai.hushh.ai' | 'uat.kai.hushh.ai' | 'hushhtech.com';
  focusedEnvironment?: 'production' | 'uat';
  focusedSource?: 'cloud_run' | 'ga4' | 'search_console' | 'product_events' | 'supabase' | 'business_funnel';
  focusedMetricKey?: string;
  focusedMetricLabel?: string;
  panelTitle?: string;
  selectedRange?: {
    startDate: string;
    endDate: string;
    preset?: '7D' | '14D' | '30D' | '90D' | 'custom';
  };
}

interface ChatResponse {
  reply: string;
  claims?: AgentClaim[];
  sources?: AgentSource[];
  warnings?: string[];
  confidence?: 'high' | 'medium' | 'low';
  suggestedQuestions?: string[];
  knowledgeSources?: AgentKnowledgeSource[];
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
  knowledgeSources?: AgentKnowledgeSource[];
  isError?: boolean;
}

interface PromptOption {
  label: string;
  prompt: string;
  description?: string;
  tone?: 'default' | 'priority' | 'warning';
}

const AGENT_NAME = 'Matrix Agent One';
const AGENT_SUBTITLE = 'Hushh metrics copilot';

const STARTER_PROMPTS: PromptOption[] = [
  {
    label: '24h report',
    prompt: 'What happened in the last 24 hours across all products? Give me a report with reliability, traffic, users, source caveats, and recommended actions.',
    tone: 'priority',
  },
  {
    label: 'All-product users',
    prompt: 'How many users does Hushh have across all products? Explain what is counted and what is not counted.',
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
    prompt: 'Give me a growth summary for hushh.ai, uat.hushh.ai, hushhtech.com, kai production, and Kai UAT for the selected range.',
  },
];

const DEEP_DIVE_PROMPTS: PromptOption[] = [
  {
    label: 'Full board review',
    description: 'Wins, risks, missing data, and next actions',
    prompt: 'Review the full dashboard like an operator. Give me wins, risks, missing data, and the next 5 actions.',
    tone: 'priority',
  },
  {
    label: 'What changed today?',
    description: 'Last-day reliability, traffic, users, and freshness',
    prompt: 'What happened in the last day across Hushh products? Separate reliability, traffic, users, funnels, source caveats, and data freshness.',
    tone: 'priority',
  },
  {
    label: 'Source health audit',
    description: 'Live, delayed, waiting, and unavailable sources',
    prompt: 'Audit every connected source. Tell me what is live, delayed, waiting, not configured, and what each status means.',
    tone: 'warning',
  },
  {
    label: 'CEO brief',
    description: 'Decision-ready numbers with caveats',
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

function knowledgeCategoryLabel(category: AgentKnowledgeSource['category']) {
  if (category === 'metric_definition') return 'Metric';
  if (category === 'source_caveat') return 'Caveat';
  if (category === 'dashboard_context') return 'Context';
  return 'Runbook';
}

function promptOptionClass(tone: PromptOption['tone'] = 'default') {
  if (tone === 'priority') return 'border-[#1a73e8]/20 bg-[#eef6ff]/95 text-[#005eb8] hover:border-[#1a73e8]/40 hover:bg-[#e3f1ff]';
  if (tone === 'warning') return 'border-[#9a5b00]/20 bg-[#fff7e6]/95 text-[#7a4b00] hover:border-[#9a5b00]/40 hover:bg-[#fff1d2]';
  return 'border-black/[0.07] bg-white/[0.82] text-[#202124] hover:border-[#1a73e8]/25 hover:bg-[#f4faff] hover:text-[#005eb8]';
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
      prompt: 'Show the Cloud Run request, 5xx, error-rate, and p95 latency trend behind the last answer.',
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
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#5f6368]">
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
            className={`min-h-9 shrink-0 rounded-full border px-3.5 text-left text-[12px] font-semibold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${promptOptionClass(option.tone)}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function HusshInsightsAgent({ context }: { context?: MatrixAgentContext }) {
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
        body: JSON.stringify({ message: trimmed, history, context }),
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
        knowledgeSources: data.knowledgeSources ?? [],
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
  }, [context, isLoading, messages]);

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
            className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-[#202124] shadow-[0_2px_10px_rgba(0,0,0,0.14),0_18px_46px_rgba(0,0,0,0.24)] transition-shadow duration-200 hover:shadow-[0_4px_14px_rgba(0,0,0,0.18),0_22px_56px_rgba(0,0,0,0.28)] active:scale-95 sm:bottom-6 sm:right-6 sm:h-16 sm:w-16"
            aria-label={`Open ${AGENT_NAME}`}
          >
            <Sparkles className="h-6 w-6 text-white sm:h-7 sm:w-7" />
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
            className="fixed inset-0 z-50 mx-0 flex h-screen h-[100dvh] max-h-screen max-h-[100dvh] w-screen max-w-none flex-col overflow-hidden border-0 bg-white/[0.92] shadow-none backdrop-blur-2xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:top-auto sm:mx-auto sm:h-[min(820px,calc(100vh-48px))] sm:max-h-[calc(100vh-32px)] sm:w-[680px] sm:max-w-[780px] sm:rounded-[28px] sm:border sm:border-white/70 sm:bg-white/[0.86] sm:shadow-[0_8px_30px_rgba(0,0,0,0.10),0_32px_90px_rgba(0,0,0,0.18)] lg:w-[760px]"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-black/[0.06] bg-white/[0.72] px-4 py-3.5 backdrop-blur-xl sm:bg-white/[0.62] sm:px-6 sm:py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] bg-[#202124] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_24px_rgba(0,0,0,0.16)] sm:h-11 sm:w-11 sm:rounded-2xl">
                  <Sparkles className="h-[18px] w-[18px] text-white sm:h-5 sm:w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-[17px] font-semibold leading-tight text-[#202124] sm:text-[18px]">{AGENT_NAME}</h2>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="hidden text-[13px] font-medium leading-tight text-[#5f6368] sm:block">{AGENT_SUBTITLE}</p>
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#1f7a36]/15 bg-[#ecfdf3] px-2 py-0.5 text-[10px] font-bold uppercase text-[#1f7a36]">
                      <Activity className="h-3 w-3" />
                      Live
                      <span className="hidden min-[390px]:inline"> Matrix</span>
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {messages.length > 0 && (
                  <button
                    onClick={clearChat}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] transition-colors hover:bg-black/[0.06] hover:text-[#202124] sm:h-9 sm:w-9"
                    aria-label="Clear conversation"
                    title="Clear conversation"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] transition-colors hover:bg-black/[0.06] hover:text-[#202124] sm:h-9 sm:w-9"
                  aria-label={`Close ${AGENT_NAME}`}
                  title="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[linear-gradient(180deg,rgba(245,245,247,0.50),rgba(255,255,255,0.30))] px-3 py-4 sm:px-6 sm:py-5">
              {messages.length === 0 ? (
                <div className="flex min-h-full flex-col items-center justify-start py-3 sm:justify-center sm:py-6">
                  <div className="mb-4 hidden h-16 w-16 items-center justify-center rounded-[24px] bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_18px_40px_rgba(0,0,0,0.08)] sm:flex">
                    <Sparkles className="h-7 w-7 text-[#1a73e8]" />
                  </div>
                  <p className="hidden text-[22px] font-semibold text-[#202124] sm:block">{AGENT_NAME}</p>
                  <p className="mb-3 text-center text-[13px] font-medium leading-relaxed text-[#5f6368] sm:mb-6 sm:mt-1 sm:text-[14px]">
                    Analyst prompts for the Hushh Matrix
                  </p>
                  <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-2.5">
                    {DEEP_DIVE_PROMPTS.map((option) => (
                      <button
                        key={option.label}
                        onClick={() => handleSuggestion(option.prompt)}
                        className={`group flex min-h-[74px] w-full items-start gap-3 rounded-[18px] border px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all duration-150 hover:-translate-y-0.5 active:scale-[0.98] sm:min-h-[94px] sm:rounded-2xl sm:px-4 sm:py-3.5 ${promptOptionClass(option.tone)}`}
                      >
                        <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          <span className="block text-[13px] font-semibold">{option.label}</span>
                          <span className="mt-0.5 block text-[11px] font-medium leading-snug opacity-75 sm:mt-1 sm:text-[12px]">{option.description ?? option.prompt}</span>
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
                        className={`max-w-[94%] rounded-[20px] px-3.5 py-2.5 text-[14px] leading-relaxed sm:max-w-[88%] sm:rounded-[22px] sm:px-4 sm:py-3 ${
                          msg.role === 'user'
                            ? 'bg-[#1a73e8] text-white shadow-[0_8px_20px_rgba(0,122,255,0.22)]'
                            : msg.isError || (hasError && msg === messages[messages.length - 1])
                              ? 'border border-red-200/70 bg-red-50/[0.88] text-[#202124]'
                              : 'border border-white/75 bg-white/[0.76] text-[#202124] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_rgba(0,0,0,0.06)] backdrop-blur-xl'
                        }`}
                      >
                        {msg.role === 'assistant' ? (
                          <div className="space-y-2">
                            <div className="space-y-1">{renderMessageContent(msg.content)}</div>
                            {!msg.isError && (
                              <div className="space-y-2 pt-1">
                                <div className="flex flex-wrap gap-1.5">
                                  {msg.confidence && (
                                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${confidenceClass(msg.confidence)}`}>
                                      {msg.confidence}
                                    </span>
                                  )}
                                  {(msg.sources ?? []).slice(0, 4).map((source) => (
                                    <span
                                      key={`${msg.id}-${source.product}-${source.source}`}
                                      className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusClass(source.status, source.available)}`}
                                      title={`${source.product}: ${source.source}`}
                                    >
                                      {source.source.replaceAll('_', ' ')}
                                    </span>
                                  ))}
                                </div>
                                {(msg.knowledgeSources ?? []).length > 0 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {(msg.knowledgeSources ?? []).slice(0, 3).map((source) => (
                                      <span
                                        key={`${msg.id}-knowledge-${source.id}`}
                                        className="rounded-full border border-black/[0.06] bg-[#f1f3f4]/85 px-2.5 py-1 text-[10px] font-bold text-[#80868b]"
                                        title={source.title}
                                      >
                                        {knowledgeCategoryLabel(source.category)} · {source.title}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {(msg.warnings ?? []).length > 0 && (
                                  <div className="rounded-xl border border-[#9a5b00]/15 bg-[#fff7e6]/80 px-3 py-2 text-[12px] font-medium leading-snug text-[#7a4b00]">
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
                      <div className="flex items-center gap-2 rounded-[22px] border border-white/75 bg-white/[0.76] px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_rgba(0,0,0,0.06)] backdrop-blur-xl">
                        <Loader2 className="h-4 w-4 animate-spin text-[#1a73e8]" />
                        <span className="text-[13px] font-medium text-[#5f6368]">Analyzing metrics...</span>
                      </div>
                    </motion.div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="border-t border-black/[0.06] bg-white/[0.78] px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:bg-white/[0.72] sm:px-5 sm:py-4">
              <div className="mb-2.5 rounded-[18px] border border-white/70 bg-white/[0.72] px-3 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:mb-3 sm:rounded-2xl sm:px-3.5 sm:py-3">
                <PromptOptionTray
                  title={messages.length === 0 ? 'Recommended messages' : 'Ask next'}
                  options={recommendedPrompts}
                  disabled={isLoading}
                  onSelect={handleSuggestion}
                />
              </div>
              <div className="flex items-end gap-2 rounded-[18px] border border-[#1a73e8]/20 bg-white px-3 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_0_0_4px_rgba(0,122,255,0.06)] transition-shadow focus-within:border-[#1a73e8]/40 focus-within:shadow-[0_1px_4px_rgba(0,0,0,0.06),0_0_0_5px_rgba(0,122,255,0.12)] sm:rounded-2xl sm:px-3.5 sm:py-3">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message ${AGENT_NAME}...`}
                  rows={1}
                  disabled={isLoading}
                  className="max-h-[112px] min-h-[28px] flex-1 resize-none bg-transparent text-[16px] text-[#202124] placeholder-[#5f6368]/70 outline-none disabled:opacity-50 sm:max-h-[140px] sm:min-h-[30px] sm:text-[15px]"
                  style={{ lineHeight: '1.5' }}
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isLoading}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1a73e8] text-white shadow-[0_8px_20px_rgba(0,122,255,0.22)] transition-all duration-150 hover:bg-[#0066d6] disabled:bg-[#d1d1d6] disabled:text-white disabled:shadow-none active:scale-90"
                  aria-label="Send message"
                >
                  <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
                </button>
              </div>
              <p className="mt-2 text-center text-[11px] font-medium text-[#5f6368]/70">
                Aggregate metrics only
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
