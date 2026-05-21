import type { NetworkConfig } from "./networks.js";

export class RpcError extends Error {
  constructor(public code: number, message: string, public data?: unknown) {
    super(`RPC ${code}: ${message}`);
  }
}

let id = 0;

export class RpcClient {
  constructor(private network: NetworkConfig) {}

  get config(): NetworkConfig {
    return this.network;
  }

  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const res = await fetch(this.network.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${this.network.rpcUrl}`);
    }
    const body = (await res.json()) as {
      result?: T;
      error?: { code: number; message: string; data?: unknown };
    };
    if (body.error) {
      throw new RpcError(body.error.code, body.error.message, body.error.data);
    }
    return body.result as T;
  }
}

export function toHex(value: number | bigint | string): string {
  if (typeof value === "string") {
    return value.startsWith("0x") ? value : "0x" + BigInt(value).toString(16);
  }
  return "0x" + BigInt(value).toString(16);
}

export function fromHex(hex: string): bigint {
  return BigInt(hex);
}

export function formatNative(weiHex: string, decimals: number, symbol: string): string {
  const wei = BigInt(weiHex);
  const base = 10n ** BigInt(decimals);
  const whole = wei / base;
  const frac = wei % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  const decimal = fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
  return `${decimal} ${symbol} (${wei.toString()} wei)`;
}
