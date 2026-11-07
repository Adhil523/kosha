import { SiteFooter } from '@/components/elements/SiteFooter';
import { SiteNav } from '@/components/elements/SiteNav';
import { DirectorySection } from '@/components/sections/DirectorySection';
import { EvidenceSection } from '@/components/sections/EvidenceSection';
import { FlowSection } from '@/components/sections/FlowSection';
import { HederaSection } from '@/components/sections/HederaSection';
import { HeroSection } from '@/components/sections/HeroSection';
import { ProductsSection } from '@/components/sections/ProductsSection';

const HomePage = () => (
  <>
    <SiteNav />
    <main className="flex flex-col">
      <HeroSection />
      <FlowSection />
      <ProductsSection />
      <EvidenceSection />
      <DirectorySection />
      <HederaSection />
    </main>
    <SiteFooter />
  </>
);

export default HomePage;
