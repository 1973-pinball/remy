import type { Meal } from './domain';

export type CoachStyle = 'short' | 'medium' | 'extended';
export interface CoachImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}
export interface CoachMessage {
  role: 'user' | 'assistant';
  text: string;
  mode: 'ai-coach';
  style: CoachStyle;
  hasPhoto: boolean;
  fingerprint?: string;
  contextFingerprint?: string;
  generatedAt?: string;
  proposalIds?: string[];
  requestDigest?: string;
  model?: string;
  references?: { title: string; url: string }[];
}
export interface CoachProposal {
  mode: 'ai-coach';
  action: 'add' | 'update';
  date: string;
  meal: Meal;
  targetId: string | null;
  targetRevision: number | null;
  status: 'pending' | 'saved' | 'dismissed';
  requestId: string;
  assumptions: string[];
  savedMealId?: string;
  generation: number;
  model: string;
  createdAt: string;
  photoDigest?: string;
}
