# Domain Glossary

## sr-receipts

The product that orchestrates accessibility execution across supported
Execution Targets, and keeps what each screen reader said as evidence.
Formerly named Dogwalk.

## Host

The machine a developer works on, and the `@sr-receipts/host` package that
connects from it to a Guest's daemon. It owns the wire protocol and knows
nothing about any screen reader.

## Guest

The side that runs a screen reader on its own interactive desktop, and the
`@sr-receipts/guest` package. It holds every Execution Target, including the
local macOS VoiceOver target, so "guest" means the reader's side of the wire
rather than a virtual machine.

## Baseline Identity

The compatibility identity that determines whether an observed accessibility
transcript may be compared with a committed baseline.

## Windows Guest Rig

The supported Windows 11 ARM64 virtual machine operated with UTM on a Mac. It
runs the NVDA-based accessibility execution environment.

## Provisioner

The idempotent setup process that turns an approved Windows Guest Rig into a
provisioned rig after Windows' unavoidable first-run and activation steps.

## Runtime Manifest

The reviewed compatibility record of the exact runtime components installed by
the Provisioner.

## Execution Target

The platform and screen-reader runtime that executes an accessibility
scenario and produces its observed speech.

## Registered Playwright Suite

A named, guest-local Playwright test suite that sr-receipts is authorized to run
with its approved configuration and artifact location.
