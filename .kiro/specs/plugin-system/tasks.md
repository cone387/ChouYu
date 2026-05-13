# Implementation Plan: ChouYu Plugin System

## Overview

Implement a standardized plugin system for the ChouYu desktop AI pet assistant. The system uses static registration with auto-generated IPC channels, declarative auth UI, and dual-trigger input modes (slash commands + toolbar buttons). BBTalk is the reference plugin implementation.

## Tasks

- [x] 1. Set up testing infrastructure
  - [x] 1.1 Add vitest and fast-check to devDependencies
    - Add `vitest`, `@vitest/coverage-v8`, and `fast-check` to `package.json` devDependencies
    - Create `vitest.config.ts` at project root configured for the main process (Node environment)
    - Add `"test": "vitest --run"` script to `package.json`
    - _Requirements: Testing infrastructure needed for Properties 1-9_

- [x] 2. Implement core plugin types and interfaces
  - [x] 2.1 Create `src/main/plugins/types.ts`
    - Define `ExecuteResult`, `AuthField`, `AuthType`, `PluginDefinition`, `PluginInfo`, and `PluginContext` interfaces
    - All types must be exported for use by registry, plugins, and renderer
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.10_

- [x] 3. Implement plugin registry with IPC auto-registration
  - [x] 3.1 Create `src/main/plugins/registry.ts`
    - Implement `PluginRegistry` class with `initialize()`, `getPlugins()`, `getPlugin(id)`, `getPluginInfos()` methods
    - Implement `checkCommandConflicts()` that throws on duplicate commands
    - Implement `createContext(pluginId)` that returns namespaced `PluginContext` using `database.ts` getState/setState
    - Implement `registerIpcChannels()` that auto-registers `plugin:{id}:execute`, `plugin:{id}:login`, `plugin:{id}:logout`, `plugin:{id}:is-authenticated`, and `plugin:get-plugins` IPC handles
    - Implement `executePlugin()` with auth pre-check, content requirement validation, and error wrapping
    - Export singleton `pluginRegistry` instance
    - Initially import an empty plugins array (BBTalk added in next task)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.3, 3.6, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 8.1, 8.2, 9.1, 9.2_

  - [ ]* 3.2 Write property tests for registry lookup completeness
    - **Property 1: Plugin registry lookup completeness**
    - **Validates: Requirements 2.3, 2.4**

  - [ ]* 3.3 Write property test for command duplicate detection
    - **Property 2: Command duplicate detection**
    - **Validates: Requirements 2.5**

  - [ ]* 3.4 Write property test for init failure resilience
    - **Property 3: Init failure resilience**
    - **Validates: Requirements 2.6**

  - [ ]* 3.5 Write property test for execute error wrapping
    - **Property 5: Execute error wrapping**
    - **Validates: Requirements 3.6**

  - [ ]* 3.6 Write property test for IPC channel auto-registration
    - **Property 6: IPC channel auto-registration**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

  - [ ]* 3.7 Write property test for state namespace isolation
    - **Property 7: State namespace isolation**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ]* 3.8 Write property test for content requirement validation
    - **Property 8: Content requirement validation**
    - **Validates: Requirements 8.1, 8.2**

  - [ ]* 3.9 Write property test for authentication pre-execution check
    - **Property 9: Authentication pre-execution check**
    - **Validates: Requirements 9.1, 9.2**

- [x] 4. Implement BBTalk plugin
  - [x] 4.1 Create `src/main/plugins/bbtalk/index.ts`
    - Implement `bbtalkPlugin` conforming to `PluginDefinition` interface
    - Implement JWT-based auth: `login()` posts to BBTalk API, stores refresh token via `PluginContext`
    - Implement `execute()` that posts content to BBTalk API with Bearer token
    - Implement token refresh logic with `scheduleRefresh()` and `refreshAccessToken()`
    - Implement `init()` that attempts to restore login state from stored refresh token
    - Implement `logout()` that clears access token and refresh timer
    - Implement `isAuthenticated()` that checks in-memory access token
    - Declare `authFields` for apiUrl, username, password
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10_

  - [x] 4.2 Update registry to import and register BBTalk plugin
    - Add `import { bbtalkPlugin } from './bbtalk'` to registry
    - Add `bbtalkPlugin` to the `PLUGINS` array
    - _Requirements: 2.1_

- [x] 5. Checkpoint - Ensure core plugin system compiles
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Extend preload bridge with plugin namespace
  - [x] 6.1 Modify `src/preload/index.ts`
    - Add `plugin` namespace to the `api` object with `execute`, `login`, `logout`, `isAuthenticated`, and `getPlugins` methods
    - Each method invokes the corresponding IPC channel using `ipcRenderer.invoke()`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 7. Extend renderer types
  - [x] 7.1 Modify `src/renderer/src/shared/types.ts`
    - Add `ExecuteResult` and `PluginInfo` interfaces (mirroring main process types for renderer use)
    - Extend `ElectronAPI` interface with `plugin` namespace containing all plugin methods
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 8. Extend CommandMenu with dynamic plugin commands
  - [x] 8.1 Modify `src/renderer/src/components/ChatPanel/CommandMenu.tsx`
    - Rename existing `COMMANDS` to `BUILTIN_COMMANDS`
    - Accept a `pluginCommands` prop (array of `{cmd, desc}`) from parent
    - Merge `BUILTIN_COMMANDS` with `pluginCommands` for filtering and display
    - Update `getFilteredCommands` to accept the merged list as parameter
    - _Requirements: 3.7, 3.8_

- [x] 9. Extend ChatPanel with plugin command handling
  - [x] 9.1 Modify `src/renderer/src/components/ChatPanel/ChatPanel.tsx`
    - Fetch plugin list on mount via `window.electronAPI.plugin.getPlugins()`
    - In `handleSend`, detect slash commands matching plugin commands (parse command name before first space)
    - Route matched plugin commands to `window.electronAPI.plugin.execute(pluginId, content)`
    - Display `ExecuteResult.message` as assistant message in chat
    - Pass `pluginCommands` to `InputArea` for forwarding to `CommandMenu`
    - _Requirements: 3.1, 3.2, 3.4, 3.5_

  - [ ]* 9.2 Write property test for command parsing and content extraction
    - **Property 4: Command parsing and content extraction**
    - **Validates: Requirements 3.1, 3.2**

- [x] 10. Implement InputArea plugin mode with toolbar buttons
  - [x] 10.1 Modify `src/renderer/src/components/ChatPanel/InputArea.tsx`
    - Accept `plugins` prop (array of `PluginInfo`)
    - Add `activePlugin` state for plugin input mode
    - Render plugin icon buttons in toolbar-left for plugins with `icon` field (max 2 visible, overflow into "⋯" menu)
    - When plugin button clicked: enter plugin mode (change placeholder, show plugin name indicator)
    - When in plugin mode and user sends: call `window.electronAPI.plugin.execute(activePlugin.id, content)` instead of `onSend`
    - Exit plugin mode on Esc or re-click of plugin button
    - Pass `pluginCommands` to `CommandMenu` component
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

- [x] 11. Implement PluginSettingsTab component
  - [x] 11.1 Create `src/renderer/src/components/Settings/PluginSettingsTab.tsx`
    - Accept `plugin: PluginInfo` prop
    - On mount, call `window.electronAPI.plugin.isAuthenticated(plugin.id)` to determine initial state
    - If not authenticated: render form fields from `plugin.authFields`, with login/save button based on `authType`
    - If authenticated: show logged-in status with logout button, and persistent fields still visible
    - On login: collect field values, validate required fields, call `plugin.login(pluginId, credentials)`
    - On logout: call `plugin.logout(pluginId)`, reset to login form
    - Display success/error messages from `ExecuteResult`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.7, 7.8, 7.9_

  - [x] 11.2 Modify `src/renderer/src/components/Settings/Settings.tsx`
    - Fetch plugin list on mount via `window.electronAPI.plugin.getPlugins()`
    - Dynamically add nav items for plugins with `hasAuth: true`
    - Render `PluginSettingsTab` when a plugin nav item is active
    - _Requirements: 6.1_

- [x] 12. Wire plugin system into main process startup
  - [x] 12.1 Modify `src/main/index.ts`
    - Import `pluginRegistry` from `./plugins/registry`
    - Call `await pluginRegistry.initialize()` after `initDatabase()` and before `registerIpcHandlers()`
    - _Requirements: 2.1, 2.2_

- [x] 13. Final checkpoint - Ensure all tests pass and app compiles
  - Run `npm run typecheck` to verify TypeScript compilation
  - Run `npm run test` to verify all property tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The project uses TypeScript with electron-vite; all new code must pass strict type checking
- BBTalk API reference implementation is in `ChewyBBTalk/desktop/src/main/auth.ts`
- Test file location: `src/main/plugins/__tests__/registry.property.test.ts`
