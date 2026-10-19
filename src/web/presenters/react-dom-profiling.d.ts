// react-dom ships a profiling build (the production reconciler with <Profiler> timing
// kept live) but @types/react-dom does not declare the entry point. Same API as client.
declare module 'react-dom/profiling' {
    export * from 'react-dom/client';
}
