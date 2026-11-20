import type { ReactNode } from "react";

type TickerSearchProps = {
  id: string;
  label: string;
  placeholder: string;
  formClassName: string;
  inputClassName: string;
  action: string;
  required?: boolean;
  leading?: ReactNode;
  button?: { className: string; content: ReactNode };
};

export function TickerSearch({
  id, label, placeholder, formClassName, inputClassName, action, required, leading, button,
}: TickerSearchProps) {
  return (
    <form role="search" aria-label={label} action={action} method="get" className={formClassName}>
      <label htmlFor={id} className="sr-only">{label}</label>
      {leading}
      <input id={id} name="q" type="search" placeholder={placeholder} autoComplete="off" required={required}
        className={`min-w-0 flex-1 border-0 bg-transparent outline-none ${inputClassName}`} />
      {button && <button type="submit" className={button.className}>{button.content}</button>}
    </form>
  );
}
