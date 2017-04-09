
import React from 'react'
import ReactDOM from 'react-dom'

export default class Statusbar extends React.Component {

  constructor(props) {
    super(props);
  }

  render() {
    var t = this;
    var mode = "";
    if (this.props.status.mode == 0)
      mode = "hide";

    return (
	    <div id="statusbar" className={mode}>
        {this.props.status.message}
	    </div>
    );
  }
}