# Domain Glossary

## Dogwalk

The product that orchestrates accessibility execution across supported
Execution Targets.

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

A named, guest-local Playwright test suite that Dogwalk is authorized to run
with its approved configuration and artifact location.
