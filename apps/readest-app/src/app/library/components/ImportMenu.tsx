import clsx from 'clsx';
import { MdLanguage, MdLink, MdMenuBook, MdRssFeed } from 'react-icons/md';
import { IoFileTray } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';

interface ImportMenuProps {
  setIsDropdownOpen?: (open: boolean) => void;
  onImportBooksFromFiles: () => void;
  onImportBooksFromDirectory?: () => void;
  onImportBookFromUrl?: () => void;
  onImportBookFromNovelUrl?: () => void;
  onImportSite?: () => void;
  onOpenFeeds: () => void;
}

const ImportMenu: React.FC<ImportMenuProps> = ({
  setIsDropdownOpen,
  onImportBooksFromFiles,
  onImportBooksFromDirectory,
  onImportBookFromUrl,
  onImportBookFromNovelUrl,
  onImportSite,
  onOpenFeeds,
}) => {
  const _ = useTranslation();

  const handleImportFromFiles = () => {
    onImportBooksFromFiles();
    setIsDropdownOpen?.(false);
  };

  const handleImportFromDirectory = () => {
    onImportBooksFromDirectory?.();
    setIsDropdownOpen?.(false);
  };

  const handleImportFromUrl = () => {
    onImportBookFromUrl?.();
    setIsDropdownOpen?.(false);
  };

  const handleImportFromNovelUrl = () => {
    onImportBookFromNovelUrl?.();
    setIsDropdownOpen?.(false);
  };

  const handleOpenFeeds = () => {
    onOpenFeeds();
    setIsDropdownOpen?.(false);
  };

  return (
    <Menu
      className={clsx('dropdown-content bg-base-100 rounded-box !relative z-[1] mt-3 p-2 shadow')}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      <MenuItem
        label={_('From Local File')}
        Icon={<IoFileTray className='h-5 w-5' />}
        onClick={handleImportFromFiles}
      />
      {onImportBooksFromDirectory && (
        <MenuItem
          label={_('From Directory')}
          Icon={<IoFileTray className='h-5 w-5' />}
          onClick={handleImportFromDirectory}
        />
      )}
      {onImportBookFromUrl && (
        <MenuItem
          label={_('From Web URL')}
          Icon={<MdLink className='h-5 w-5' />}
          onClick={handleImportFromUrl}
        />
      )}
      {onImportBookFromNovelUrl && (
        <MenuItem
          label={_('From Web Novel')}
          Icon={<MdMenuBook className='h-5 w-5' />}
          onClick={handleImportFromNovelUrl}
        />
      )}
      {onImportSite && (
        <MenuItem
          label={_('Import Website')}
          Icon={<MdLanguage className='h-5 w-5' />}
          onClick={() => {
            onImportSite();
            setIsDropdownOpen?.(false);
          }}
        />
      )}
      <MenuItem
        label={_('From Feed URL')}
        Icon={<MdRssFeed className='h-5 w-5' />}
        onClick={handleOpenFeeds}
      />
    </Menu>
  );
};

export default ImportMenu;
