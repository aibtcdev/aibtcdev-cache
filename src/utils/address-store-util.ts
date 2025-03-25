import { Env } from '../../worker-configuration';

/**
 * KV storage key for the list of known Stacks addresses
 */
const KNOWN_ADDRESSES_KEY = 'aibtcdev_known_stacks_addresses';

/**
 * Retrieves the list of known Stacks addresses from KV storage
 * 
 * @param env - The Cloudflare Worker environment
 * @returns Array of known Stacks addresses
 */
export async function getKnownAddresses(env: Env): Promise<string[]> {
	const addresses = await env.AIBTCDEV_CACHE_KV.get<string[]>(KNOWN_ADDRESSES_KEY, 'json');
	return addresses || [];
}

/**
 * Adds a Stacks address to the list of known addresses in KV storage
 * Only adds the address if it's not already in the list
 * 
 * @param env - The Cloudflare Worker environment
 * @param address - The Stacks address to add
 */
export async function addKnownAddress(env: Env, address: string): Promise<void> {
	const addresses = await getKnownAddresses(env);
	if (!addresses.includes(address)) {
		addresses.push(address);
		await env.AIBTCDEV_CACHE_KV.put(KNOWN_ADDRESSES_KEY, JSON.stringify(addresses));
	}
}
