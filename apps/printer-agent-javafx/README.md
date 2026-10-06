# Print Automated — JavaFX Desktop Agent

A modern, rich desktop application for Print Automated shop operations and printer agent management, built with **Java 21** and **JavaFX**.

## Features

- **Modern Dark Theme UI**: Matches the exact GitHub/Vercel-inspired dark palette of `apps/shop-web`.
- **Overview & Pairing**: Real-time agent status monitor, live connection pill, device ID, linked shop, and 8-character pairing code input.
- **Orders & Queue (Slice 2 Parity)**: Live tabular queue with search, status pills (In Production, Completed, Draft, etc.), payment badges, formatted currency, and background-thread fetching.
- **Connected Printers**: Discovers local system printers, capability flags (Color, Monochrome, Duplex, A4, A3), and default printer tags.
- **Staff Authentication (Slice 1 Parity)**: In-app sign-in modal, session management with JWT expiry checking, and DPAPI-protected persistence.
- **System Tray**: Windows notification area tray icon with quick actions and minimize/restore.

## Prerequisites

- **Java 21** (JDK 21 LTS or later)
- **Gradle 9+** (or use included `./gradlew`)

## Running

From this folder:

```powershell
./gradlew run
```

## Running Tests

```powershell
./gradlew test
```

## Building Executable Application

```powershell
./gradlew build
```
