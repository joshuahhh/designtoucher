# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Development
- `npm run dev` - Start development server with Vite
- `npm run build` - Build for production
- `npm run careful-build` - TypeScript check followed by build

### Testing
- `npm run test:run` - Run tests once
- `npm run test:watch` - Run tests in watch mode
- `npm run test:ui` - Run tests with UI

### Library Build
- `npm run build-lib` - Build library distribution (clears lib/ and compiles TypeScript)
- `npm run prepublishOnly` - Automatic library build before publishing

## Architecture Overview

DesignToucher is a visual programming environment for real-time image processing and computer vision operations. The application is built with React and uses a node-based flow interface powered by ReactFlow.

### Core Components

**Flow System (`Flow.tsx`)**
- Main visual programming interface using ReactFlow
- Node-based editor where each node represents an image processing operation
- Real-time execution with automatic flow updates via animation loops
- Drag-and-drop component palette in collapsible sidebar
- Supports copy/paste, viewport persistence, and keyboard shortcuts (press 'r' to reset runtimes)

**Operation Framework (`flow-lib.tsx`)**
- Extensible system for image processing operations
- Each operation inherits from `BaseOp` class
- Operations can have parameters (number, string, boolean) with UI controls
- Operations are organized into groups for the sidebar palette
- Topological sorting ensures correct execution order

**OmniCanvas System (`OmniCanvas.tsx`)**
- WebGL2-based rendering context shared across all operations
- Provides texture management and drawing capabilities
- Manages framebuffer operations for efficient GPU-based processing
- Context-based architecture for WebGL resource sharing

**GL Utilities (`mygl.ts`)**
- Low-level WebGL2 wrapper functions
- Texture and framebuffer management
- Shader program compilation and management
- 3D texture support for temporal effects

### Key Features

- **Real-time Processing**: All operations run continuously in animation loops
- **WebGL Acceleration**: GPU-based image processing for performance
- **Webcam Integration**: Live camera input support
- **Parameter Animation**: Automatic parameter animation with min/max bounds
- **Time Machine Effects**: 3D texture support for temporal processing
- **GLSL Integration**: Custom shader operations support
- **Persistent State**: Flow state and viewport saved to localStorage

### Project Structure

- `src/App.tsx` - Root application component with flow state management
- `src/Flow.tsx` - Main flow interface and node rendering
- `src/flow-lib.tsx` - Operation definitions and flow execution engine  
- `src/OmniCanvas.tsx` - WebGL context and rendering infrastructure
- `src/mygl.ts` - WebGL utilities and resource management
- `src/webcam.tsx` - Camera input handling
- `lib/` - Compiled library distribution
- `public/Nature/` - Sample video assets

### Development Notes

- The application requires HTTPS for webcam access (handled by basicSsl plugin)
- TypeScript strict mode with separate build configs for app and library
- **Styling**: Uses Tailwind CSS with inline classes. The `xy-theme.css` file is NOT imported - all styling is done via Tailwind utility classes applied directly to components
- ESLint configuration for code quality
- Uses Vite for fast development builds

### Git Workflow

When making changes, Claude Code should:
1. Implement the requested changes
2. **Run Prettier to format all changed files**
3. Ask the user to test the changes and confirm they work correctly
4. **Wait for user confirmation before committing**
5. Only commit after receiving positive feedback
6. Use clear, concise commit messages with Claude Code attribution
7. Each commit should represent a logical unit of work

### Code Formatting

- **Always run Prettier before asking for feedback or committing**
- Command: `npx prettier --write <files>`
- Prettier automatically formats code according to project standards