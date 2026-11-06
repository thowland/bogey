// Must fail to compile under core's tsconfig: core has no DOM or Node types.
export const title = document.title;
export const bytes = Buffer.from('x');
