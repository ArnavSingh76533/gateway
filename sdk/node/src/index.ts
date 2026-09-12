import OpenAI from 'openai';
import type { ClientOptions } from 'openai';

export type GatewayOptions = ClientOptions;
export class Gateway extends OpenAI {
  constructor(options: GatewayOptions = {}) {
    const baseURL = options.baseURL ?? process.env.GATEWAY_BASE_URL;
    const apiKey = options.apiKey ?? process.env.GATEWAY_API_KEY;
    if (!baseURL || !apiKey) throw new Error('Set GATEWAY_BASE_URL and GATEWAY_API_KEY or pass both explicitly.');
    super({ ...options, baseURL, apiKey, maxRetries: options.maxRetries ?? 0 });
  }
}
export default Gateway;
