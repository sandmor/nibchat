export {
  formatSpaceRules,
  type SpaceResolutionDecision,
  type SpaceRule,
  type SpaceUnresolvedReference,
} from "@/lib/spaces/composition"
export {
  assertSpaceSettingsLocks,
  definedSettingKeys,
  omitModelProviderRef,
  omitPromptStackRef,
  parseSpaceSettings,
  spacePolicyImpact,
  spaceSettingsSchema,
  spaceSettingsToJson,
  type SpacePolicyMode,
  type SpaceSettings,
} from "@/lib/spaces/settings"
export {
  assertSpaceMoveAllowed,
  orderSpacesForInsert,
  spaceChain,
  spaceDepth,
  spaceDescriptionSchema,
  spaceFromRow,
  spaceNameSchema,
  spaceSubtreeHeight,
  spaceSubtreeIds,
  spacesById,
  type SpaceRecord,
} from "@/lib/spaces/tree"
export type { SpaceLockSource } from "@/lib/spaces/types"
