export interface BlockchainInfo {
  server_version: string;
  status: string;
  chain_tip: {
    block_height: number;
    block_hash: string;
  };
}

export interface ExtendedInfo {
  // Add specific fields as needed
  [key: string]: any;
}

export interface ApiEndpoint {
  path: string;
  fetch(): Promise<any>;
  update(): Promise<void>;
}
