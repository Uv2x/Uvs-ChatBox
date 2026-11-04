// Zod schemas used to validate every IPC payload coming from the renderer.
// Schemas are intentionally permissive about *extra* keys (default zod
// behavior) to stay backward-compatible with stored AppSettings, but strict
// about the *types* of fields the main process touches.

import { z } from 'zod';

export const SendTargetSchema = z.enum(['desktop', 'vr', 'both']);

export const OscSettingsSchema = z.object({
  ip: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  listenPort: z.number().int().min(1).max(65535),
  sendImmediately: z.boolean(),
  playSound: z.boolean(),
  target: SendTargetSchema,
});

// AppSettings is large and user-mutable. We validate the shape of the keys we
// actually consume in the main process; everything else is passed through.
export const AppSettingsSchema = z
  .object({
    osc: OscSettingsSchema,
    modules: z.array(
      z.object({
        id: z.string(),
        enabled: z.boolean(),
        order: z.number(),
        template: z.string().optional(),
      }),
    ),
    updateIntervalSec: z.number().min(1).max(3600),
    clock24h: z.boolean(),
    customText: z.string().max(4096),
  })
  .passthrough();

// ---- Actions (must match the Action union in shared/core.ts) ----
export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sendText'),
    text: z.string().max(4096),
    bypassDedupe: z.boolean().optional(),
    pinKey: z.string().max(256).optional(),
    noPin: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('setStatus'), statusId: z.string().min(1).max(128) }),
  z.object({
    kind: z.literal('setParameter'),
    address: z
      .string()
      .min(1)
      .max(256)
      .regex(/^\/[A-Za-z0-9_\-/]+$/, 'invalid OSC address'),
    value: z.union([z.number(), z.boolean()]),
    valueType: z.enum(['int', 'float', 'bool']),
  }),
  z.object({ kind: z.literal('clearChatbox') }),
  z.object({
    kind: z.literal('setVariable'),
    name: z.string().min(1).max(64),
    value: z.string().max(512),
  }),
  z.object({ kind: z.literal('switchProfile'), profileId: z.string().min(1).max(128) }),
  z.object({ kind: z.literal('runMacro'), macroId: z.string().min(1).max(128) }),
  z.object({ kind: z.literal('runTimeline'), timelineId: z.string().min(1).max(128) }),
  z.object({ kind: z.literal('delay'), ms: z.number().int().min(0).max(60_000) }),
]);

export const ActionArraySchema = z.array(ActionSchema).max(256);

export const MessageTextSchema = z.string().max(4096);
export const TypingSchema = z.boolean();
export const IdSchema = z.string().min(1).max(128);

export const RelaySlotSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(['pcMetrics', 'audioStatus', 'nowPlaying', 'currentStatus', 'custom']),
  enabled: z.boolean(),
  holdMs: z.number().int().min(1000).max(600_000).optional(),
  text: z.string().max(512).optional(),
});

export const RelayConfigSchema = z.object({
  enabled: z.boolean(),
  defaultHoldMs: z.number().int().min(2000).max(600_000),
  keepAliveMs: z.number().int().min(2000).max(60_000),
  slots: z.array(RelaySlotSchema).max(32),
  batteryCriticalPct: z.number().int().min(1).max(100),
});

export type AppSettingsInput = z.infer<typeof AppSettingsSchema>;
export type ActionInput = z.infer<typeof ActionSchema>;
export type RelayConfigInput = z.infer<typeof RelayConfigSchema>;
