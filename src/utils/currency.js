export const currency = (cents=0) => new Intl.NumberFormat('en-US',{ style:'currency', currency:'USD' }).format((cents||0)/100);
