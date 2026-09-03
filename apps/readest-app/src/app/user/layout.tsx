import { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Lumen',
  description: 'Lumen library',
};

export default function ProfileLayout() {
  redirect('/library');
}
