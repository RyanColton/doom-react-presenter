// react-dom's profiling entry point has the same API as react-dom/client but keeps
// <Profiler> timing enabled in production. @types/react-dom does not declare it.
declare module 'react-dom/profiling' {
    export * from 'react-dom/client';
}
