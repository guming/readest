import { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Readest',
  description: 'Readest library',
};

export default function ProfileLayout() {
  redirect('/library');
}
