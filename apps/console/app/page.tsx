import { ROUTES } from '@/lib/routes';
import { redirect } from 'next/navigation';

const HomePage = () => redirect(ROUTES.owner.overview);

export default HomePage;
