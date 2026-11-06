import { SiteFooter } from '@/components/elements/SiteFooter';
import { SiteNav } from '@/components/elements/SiteNav';
import { HeroSection } from '@/components/sections/HeroSection';

const HomePage = () => (
  <>
    <SiteNav />
    <main className="flex flex-col">
      <HeroSection />
    </main>
    <SiteFooter />
  </>
);

export default HomePage;
