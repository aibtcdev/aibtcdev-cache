import { Env } from '../../worker-configuration';

const KNOWN_ADDRESSES_KEY = 'known_stacks_addresses';

export async function getKnownAddresses(env: Env): Promise<string[]> {
    const addresses = await env.AIBTCDEV_CACHE_KV.get<string[]>(KNOWN_ADDRESSES_KEY, 'json');
    return addresses || [];
}

export async function addKnownAddress(env: Env, address: string): Promise<void> {
    const addresses = await getKnownAddresses(env);
    if (!addresses.includes(address)) {
        addresses.push(address);
        await env.AIBTCDEV_CACHE_KV.put(KNOWN_ADDRESSES_KEY, JSON.stringify(addresses));
    }
}

export async function extractAddressesFromKV(env: Env): Promise<string[]> {
    const addresses = new Set<string>();
    let cursor: string | null = null;

    do {
        const result = await env.AIBTCDEV_CACHE_KV.list({ cursor });
        cursor = result.list_complete ? null : result.cursor;

        for (const key of result.keys) {
            const match = key.name.match(/hiro-api_extended_v1_address_([A-Z0-9]+)_(assets|balances)/);
            if (match) {
                addresses.add(match[1]);
            }
        }
    } while (cursor != null);

    return Array.from(addresses);
}
