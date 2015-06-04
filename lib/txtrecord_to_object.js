exports.txtRecordToObject = function txtRecordToObject(txt) {
  return txt.reduce(function (obj, t) {
    var i = t.indexOf('=');
    if (i > 0) {
      Object.defineProperty(obj, t.slice(0, i),
                            {value : t.slice(i + 1), enumerable:true});
    }
    else if (i === -1) {
      Object.defineProperty(obj, t, {value : undefined, enumerable:true});
    }
    //else {/*ignored*/}

    return obj;
  }, {});
};
