const SearchFilterBar = ({
  search,
  setSearch,
  searchPlaceholder = 'Search...',
  searchId = 'workspace-search',
  searchName = 'workspaceSearch',
  singleRowDesktop = false,
  controlsNoWrapOnDesktop = false,
  children
}) => (
  <div className={`mb-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm ${singleRowDesktop ? 'grid grid-cols-1 gap-3 xl:grid-cols-5 xl:items-center' : 'flex flex-col gap-3 md:flex-row md:items-center'}`}>
    <input
      className={`form-field ${singleRowDesktop ? 'w-full' : controlsNoWrapOnDesktop ? 'md:w-56 md:flex-none xl:w-72' : 'md:max-w-sm'}`}
      id={searchId}
      name={searchName}
      placeholder={searchPlaceholder}
      value={search}
      onChange={(event) => setSearch(event.target.value)}
    />
    <div className={`${singleRowDesktop ? 'contents' : `flex flex-1 gap-3 ${controlsNoWrapOnDesktop ? 'flex-wrap xl:flex-nowrap' : 'flex-wrap'}`}`}>{children}</div>
  </div>
);

export default SearchFilterBar;
