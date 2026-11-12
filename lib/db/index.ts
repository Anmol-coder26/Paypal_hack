import type { PunchPayRepository } from "./repository";
import { SqliteRepository } from "./sqlite";
import { SupabaseRepository } from "./supabase";

let singleton: PunchPayRepository | null = null;

export function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(url && key);
}

export function getRepo(): PunchPayRepository {
  if (singleton) return singleton;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    singleton = new SupabaseRepository(url, key);
  } else {
    singleton = new SqliteRepository();
  }
  return singleton;
}

export function resetRepoForTests(): void {
  if (singleton && singleton instanceof SqliteRepository) {
    singleton.close();
  }
  singleton = null;
}
