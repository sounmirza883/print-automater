import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import {
  Capabilities,
  Faq,
  Features,
  FinalCta,
  Hero,
  HowItWorks,
  Integrations,
  Overview,
  Pricing,
  ProductPreview,
  Resources,
  Security,
  Testimonials,
  UseCases,
} from "@/components/sections";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="outline-none">
        <Hero />
        <Overview />
        <Features />
        <Capabilities />
        <ProductPreview />
        <HowItWorks />
        <UseCases />
        <Security />
        <Integrations />
        <Pricing />
        <Resources />
        <Testimonials />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
