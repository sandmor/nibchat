"use client"
import { create } from "zustand"

type StreamState = {
  active: Record<
    string,
    {
      nodeId: string
      chatId: string
      startedAt: number
      text: string
      reasoning: string
    }
  >
  controllers: Record<string, AbortController>
  start: (streamId: string, value: { nodeId: string; chatId: string }) => void
  appendText: (streamId: string, delta: string) => void
  appendReasoning: (streamId: string, delta: string) => void
  attachController: (streamId: string, controller: AbortController) => void
  stop: (streamId: string) => void
  finish: (streamId: string) => void
}
export const useStreamStore = create<StreamState>((set) => ({
  active: {},
  controllers: {},
  start: (streamId, value) =>
    set((state) => ({
      active: {
        ...state.active,
        [streamId]: {
          ...value,
          startedAt: Date.now(),
          text: "",
          reasoning: "",
        },
      },
    })),
  appendText: (streamId, delta) =>
    set((state) => {
      const stream = state.active[streamId]
      if (!stream) return state
      return {
        active: {
          ...state.active,
          [streamId]: { ...stream, text: stream.text + delta },
        },
      }
    }),
  appendReasoning: (streamId, delta) =>
    set((state) => {
      const stream = state.active[streamId]
      if (!stream) return state
      return {
        active: {
          ...state.active,
          [streamId]: { ...stream, reasoning: stream.reasoning + delta },
        },
      }
    }),
  attachController: (streamId, controller) =>
    set((state) => ({
      controllers: { ...state.controllers, [streamId]: controller },
    })),
  stop: (streamId) => {
    useStreamStore.getState().controllers[streamId]?.abort()
  },
  finish: (streamId) =>
    set((state) => {
      const active = { ...state.active }
      const controllers = { ...state.controllers }
      delete active[streamId]
      delete controllers[streamId]
      return { active, controllers }
    }),
}))
