import { type LlmProvider } from './config';
import { ChatAnthropic } from '@langchain/anthropic';
import { type BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';

// Overridable with LLM_MODEL
export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-6.1-terra'
};

export const createChatModel = (
  provider: LlmProvider,
  apiKey: string,
  model = DEFAULT_MODELS[provider]
): BaseChatModel =>
  provider === 'anthropic'
    ? new ChatAnthropic({ model, apiKey })
    : new ChatOpenAI({ model, apiKey });
