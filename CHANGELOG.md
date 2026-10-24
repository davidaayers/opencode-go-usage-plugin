# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2](https://github.com/davidaayers/opencode-go-usage-plugin/compare/v1.0.1...v1.0.2) (2026-10-24)


### Fixed

* keep Go usage gauges within a consistent row width ([0e88931](https://github.com/davidaayers/opencode-go-usage-plugin/commit/0e889317e8b0bfcd9c86593458e6e60e3901737a))

## [1.0.1](https://github.com/davidaayers/opencode-go-usage-plugin/compare/v1.0.0...v1.0.1) (2026-10-23)


### Fixed

* prepend sidebar usage and collapse hidden content ([52cdf3d](https://github.com/davidaayers/opencode-go-usage-plugin/commit/52cdf3df05a6321901dd2910c5914239f7e98dad))
* prepend sidebar usage and collapse hidden content ([5ba3027](https://github.com/davidaayers/opencode-go-usage-plugin/commit/5ba3027ed11ce874e5b9b529162a8eed796732cb))
* restore automatic release version increments ([#7](https://github.com/davidaayers/opencode-go-usage-plugin/issues/7)) ([5ec6f27](https://github.com/davidaayers/opencode-go-usage-plugin/commit/5ec6f279abe993f45c0bb6ff76e39c086a7c0f54))

## [1.0.0](https://github.com/davidaayers/opencode-go-usage-plugin/compare/v0.1.4...v1.0.0) (2026-10-23)


### Added

* migrate the TUI plugin to OpenCode v2 ([004a075](https://github.com/davidaayers/opencode-go-usage-plugin/commit/004a0758b5a49e3d972f96c93627ab9ac4532225))


### Changed

* adopt canonical TUI package template ([20d0946](https://github.com/davidaayers/opencode-go-usage-plugin/commit/20d09460e6898b0782d9740759a530a76faeb5fe))

## [Unreleased]

### Breaking Changes

- Prepare 1.0.0 for OpenCode 2.x only (minimum 2.1.3; OpenCode 3.x is not supported).
- Replace the V1 plugin API and configuration with `Plugin.define` and global `cli.json` loading.
- OpenCode 1.x users must pin `@davidaayers/opencode-go-usage-plugin@0.1.4`, the last V1 release.

### Changed

- Standardize the Solid-transformed `src/tui.tsx` build, host-provided runtimes, packed verification, and generated local-directory entry.
- Read the active OpenCode Console credential through the V2 API, preserving usage API error details.

## [0.1.4](https://github.com/davidaayers/opencode-go-usage-plugin/compare/v0.1.3...v0.1.4) (2026-09-27)


### Fixed

* compile JSX with the Solid transform so the UI is reactive ([da78e57](https://github.com/davidaayers/opencode-go-usage-plugin/commit/da78e571fa5368e27c9ee9a1ee00520dfbedb4ec))

## [0.1.3](https://github.com/davidaayers/opencode-go-usage-plugin/compare/v0.1.2...v0.1.3) (2026-09-27)


### Fixed

* ship compiled dist entry so npm plugin loads ([42f6f30](https://github.com/davidaayers/opencode-go-usage-plugin/commit/42f6f305f67fe52845b8bf4068f8ab832532a999))

## [0.1.2] - 2026-08-28

### Changed

- Standardize package tooling on pnpm.
- Refresh the README structure and shared plugin roadmap link.

## [0.1.1] - 2026-08-24

### Added

- Initial public npm release of the OpenCode Go usage sidebar plugin.
- 5-hour, weekly, and monthly usage gauges with reset countdowns.
- Compact prompt status showing the binding usage constraint.
