# @nimbus-dev/client Changelog

All notable changes to `@nimbus-dev/client` are documented in this file. release-please appends new entries between this header and the most recent version below when a release PR merges.

## [0.6.2](https://github.com/nimbus-agent/nimbus-client/compare/client-v0.6.1...client-v0.6.2) (2026-07-23)


### Bug Fixes

* **ci:** widen the publish-verification retry budget and defeat the cached packument ([#13](https://github.com/nimbus-agent/nimbus-client/issues/13)) ([e98952c](https://github.com/nimbus-agent/nimbus-client/commit/e98952cfbf225424d1931ceb213810665a8cd80e))

## [0.6.1](https://github.com/nimbus-agent/nimbus-client/compare/client-v0.6.0...client-v0.6.1) (2026-07-22)


### Bug Fixes

* **ci:** retry the provenance audit, not just the install ([#10](https://github.com/nimbus-agent/nimbus-client/issues/10)) ([642d19b](https://github.com/nimbus-agent/nimbus-client/commit/642d19ba8e2b65bd5a2a3ceb6235fcd18a04e985))

## [0.6.0](https://github.com/nimbus-agent/nimbus-client/compare/client-v0.5.0...client-v0.6.0) (2026-07-22)


### ⚠ BREAKING CHANGES

* queryItems returns validated IndexedItem[] instead of raw rows ([#6](https://github.com/nimbus-agent/nimbus-client/issues/6))

### Features

* queryItems returns validated IndexedItem[] instead of raw rows ([#6](https://github.com/nimbus-agent/nimbus-client/issues/6)) ([8e373d0](https://github.com/nimbus-agent/nimbus-client/commit/8e373d0bea6e207641fbdb5782a677ff44b57ce5))


### Bug Fixes

* **ci:** mint release-please token from the App, and keep 0.x pre-1.0 ([#8](https://github.com/nimbus-agent/nimbus-client/issues/8)) ([d21fb0b](https://github.com/nimbus-agent/nimbus-client/commit/d21fb0bc5c4934d62c734f7ae98e04fd67182b2a))

## [0.5.0](https://github.com/nimbus-agent/nimbus-client/compare/client-v0.4.0...client-v0.5.0) (2026-07-16)


### Miscellaneous Chores

* cut first standalone release 0.5.0 ([d6309cf](https://github.com/nimbus-agent/nimbus-client/commit/d6309cf6f72eaf153185ca2db13775b81801ea07))

## [0.4.0](https://github.com/nimbus-agent/Nimbus/compare/client-v0.3.0...client-v0.4.0) (2026-07-14)


### Features

* **client:** expose egress ledger reads on NimbusClient + MockClient ([#751](https://github.com/nimbus-agent/Nimbus/issues/751)) ([31c05b2](https://github.com/nimbus-agent/Nimbus/commit/31c05b25c17b858d14980455ad8800fbfb99e875))

## [0.3.0](https://github.com/nimbus-agent/Nimbus/compare/client-v0.2.6...client-v0.3.0) (2026-06-23)


### Features

* **client:** add searchRanked to NimbusClient + MockClient ([#742](https://github.com/nimbus-agent/Nimbus/issues/742)) ([a378884](https://github.com/nimbus-agent/Nimbus/commit/a378884360c50b55f1d76bcd61492c1594327b86))


### Bug Fixes

* add repository field to client, sdk, and root for npm provenance ([#633](https://github.com/nimbus-agent/Nimbus/issues/633)) ([f0e7f07](https://github.com/nimbus-agent/Nimbus/commit/f0e7f075d755c8b4a006911b513979f289fa192f))
* **client:** bundle sdk via the "bun" condition so the publish build resolves ([#638](https://github.com/nimbus-agent/Nimbus/issues/638)) ([c1f36d2](https://github.com/nimbus-agent/Nimbus/commit/c1f36d2e1cee0f02430aab5f48e517a9882ccf4d))
* **client:** widen node-compat askStream streamId poll to STREAM_TIMEOUT_MS ([#624](https://github.com/nimbus-agent/Nimbus/issues/624)) ([e86014f](https://github.com/nimbus-agent/Nimbus/commit/e86014f3ae3b2a865a0e589eda2eb997b33ca727))
* **sonar:** clear the SonarCloud board — S5906 sweep + long-tail code smells ([#731](https://github.com/nimbus-agent/Nimbus/issues/731)) ([3a87e54](https://github.com/nimbus-agent/Nimbus/commit/3a87e54a7335c1be87ecb582673183b242b97c88))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @nimbus-dev/sdk bumped to 1.2.1

## [0.2.6](https://github.com/nimbus-agent/Nimbus/compare/client-v0.2.5...client-v0.2.6) (2026-06-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @nimbus-dev/sdk bumped to 1.2.1

## [0.2.5](https://github.com/nimbus-agent/Nimbus/compare/client-v0.2.4...client-v0.2.5) (2026-06-23)


### Bug Fixes

* **sonar:** clear the SonarCloud board — S5906 sweep + long-tail code smells ([#731](https://github.com/nimbus-agent/Nimbus/issues/731)) ([3a87e54](https://github.com/nimbus-agent/Nimbus/commit/3a87e54a7335c1be87ecb582673183b242b97c88))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @nimbus-dev/sdk bumped to 1.2.1

## [0.2.4](https://github.com/nimbus-agent/Nimbus/compare/client-v0.2.3...client-v0.2.4) (2026-06-22)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @nimbus-dev/sdk bumped to 1.2.0

## [0.2.3](https://github.com/nimbus-agent/Nimbus/compare/client-v0.2.2...client-v0.2.3) (2026-06-15)


### Bug Fixes

* **client:** bundle sdk via the "bun" condition so the publish build resolves ([#638](https://github.com/nimbus-agent/Nimbus/issues/638)) ([c1f36d2](https://github.com/nimbus-agent/Nimbus/commit/c1f36d2e1cee0f02430aab5f48e517a9882ccf4d))

## [0.2.2](https://github.com/nimbus-agent/Nimbus/compare/client-v0.2.1...client-v0.2.2) (2026-06-14)


### Bug Fixes

* add repository field to client, sdk, and root for npm provenance ([#633](https://github.com/nimbus-agent/Nimbus/issues/633)) ([f0e7f07](https://github.com/nimbus-agent/Nimbus/commit/f0e7f075d755c8b4a006911b513979f289fa192f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @nimbus-dev/sdk bumped to 1.1.2

## [0.2.1](https://github.com/nimbus-agent/Nimbus/compare/client-v0.2.0...client-v0.2.1) (2026-06-14)


### Bug Fixes

* **client:** widen node-compat askStream streamId poll to STREAM_TIMEOUT_MS ([#624](https://github.com/nimbus-agent/Nimbus/issues/624)) ([e86014f](https://github.com/nimbus-agent/Nimbus/commit/e86014f3ae3b2a865a0e589eda2eb997b33ca727))

## [0.2.0] - 2026-05-13

- Pre-automation snapshot. The `0.2.0` version was bumped in `package.json` ahead of the first automated release; no `client-v0.2.0` tag was published. The next release-please-managed entry will prepend above this line.
