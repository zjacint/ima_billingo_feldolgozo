/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // A Next.js standalone file-tracer nem mindig ismeri fel a Prisma
  // dinamikusan (futásidőben, számított útvonalon) betöltött motor
  // binárisait, ezért ezeket explicit be kell venni, különben a
  // .next/standalone kimenetből hiányozhat a helyes (pl. Docker
  // futtatókörnyezethez illő) query engine .so fájl.
  experimental: {
    outputFileTracingIncludes: {
      '/**': ['./node_modules/.prisma/client/**/*'],
    },
  },
};

export default nextConfig;
