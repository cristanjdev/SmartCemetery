/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep pdfkit and exceljs out of the server bundle so they load from
  // node_modules at runtime. pdfkit reads font-metric data files (e.g.
  // Helvetica.afm) relative to its package path, which a bundler cannot trace,
  // so bundling it breaks PDF generation. exceljs is externalized for the same
  // robustness reason.
  serverExternalPackages: ["pdfkit", "exceljs"],

  // The public map navigator used to live at /kiosk (there is no kiosk screen);
  // old links and QR codes keep working, with their ?grave=… query.
  async redirects() {
    return [{ source: "/kiosk", destination: "/map", permanent: true }];
  },
};

export default nextConfig;
